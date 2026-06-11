<?php
/**
 * Authentication & access control for the MCP Catalog management surface.
 *
 * Provides:
 *  - An email allowlist (option `aisg_mcp_catalog_allowlist`) of who may manage the catalog.
 *  - A "Manage Access" admin page to edit the allowlist.
 *  - OTP + session-token primitives used by the auth REST endpoints.
 *  - Request-level helpers to resolve the authenticated email from a Bearer token.
 *
 * No catalog data lives here; this class only governs *who* may mutate it.
 *
 * @package AISG_MCP_Catalog
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class AISG_MCP_Catalog_Auth
 */
class AISG_MCP_Catalog_Auth {

	/**
	 * Option storing the lowercased email allowlist (array of strings).
	 */
	const OPT_ALLOWLIST = 'aisg_mcp_catalog_allowlist';

	/**
	 * Admin page slug for the "Manage Access" submenu.
	 */
	const PAGE_SLUG = 'mcp-catalog-access';

	/**
	 * Transient prefixes.
	 */
	const OTP_PREFIX     = 'mcpcat_otp_';
	const SESS_PREFIX    = 'mcpcat_sess_';
	const RATE_PREFIX    = 'mcpcat_otp_rate_';

	/**
	 * OTP / session / rate-limit tuning.
	 */
	const OTP_TTL          = 600;   // 10 minutes.
	const OTP_MAX_ATTEMPTS = 5;     // Verification attempts per OTP.
	const SESSION_TTL      = 7200;  // 2 hours.
	const RATE_WINDOW      = 900;   // 15 minutes.
	const RATE_MAX         = 5;     // Max OTP requests per email per window.

	/**
	 * Hook admin menu + form handler.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'add_menu' ) );
		add_action( 'admin_post_aisg_mcp_save_allowlist', array( __CLASS__, 'handle_save_allowlist' ) );
	}

	/* ---------------------------------------------------------------------
	 * Allowlist
	 * ------------------------------------------------------------------- */

	/**
	 * Get the allowlist as an array of lowercased emails.
	 *
	 * @return string[]
	 */
	public static function get_allowlist() {
		$list = get_option( self::OPT_ALLOWLIST, array() );
		if ( ! is_array( $list ) ) {
			$list = array();
		}
		// Normalise defensively.
		$clean = array();
		foreach ( $list as $email ) {
			$email = strtolower( trim( (string) $email ) );
			if ( '' !== $email ) {
				$clean[ $email ] = true;
			}
		}
		return array_keys( $clean );
	}

	/**
	 * Whether the given email is on the allowlist (case-insensitive).
	 *
	 * @param string $email Email to test.
	 * @return bool
	 */
	public static function is_allowed( $email ) {
		$email = strtolower( trim( (string) $email ) );
		if ( '' === $email ) {
			return false;
		}
		return in_array( $email, self::get_allowlist(), true );
	}

	/* ---------------------------------------------------------------------
	 * Rate limiting
	 * ------------------------------------------------------------------- */

	/**
	 * Whether the email has exceeded the OTP-request rate limit.
	 *
	 * @param string $email Email (already sanitized/lowercased).
	 * @return bool True when the limit is exceeded.
	 */
	public static function is_rate_limited( $email ) {
		$key   = self::RATE_PREFIX . md5( strtolower( $email ) );
		$count = (int) get_transient( $key );
		return $count >= self::RATE_MAX;
	}

	/**
	 * Increment the OTP-request counter for the email within the rate window.
	 *
	 * @param string $email Email (already sanitized/lowercased).
	 * @return void
	 */
	public static function bump_rate( $email ) {
		$key   = self::RATE_PREFIX . md5( strtolower( $email ) );
		$count = (int) get_transient( $key );
		set_transient( $key, $count + 1, self::RATE_WINDOW );
	}

	/* ---------------------------------------------------------------------
	 * OTP
	 * ------------------------------------------------------------------- */

	/**
	 * Generate, hash, and store a fresh 6-digit OTP for the email.
	 *
	 * @param string $email Email (already sanitized/lowercased).
	 * @return string The plaintext OTP (to be emailed).
	 */
	public static function issue_otp( $email ) {
		$otp = (string) wp_rand( 0, 999999 );
		$otp = str_pad( $otp, 6, '0', STR_PAD_LEFT );

		$record = array(
			'hash'     => wp_hash_password( $otp ),
			'attempts' => 0,
			'created'  => time(),
		);
		set_transient( self::OTP_PREFIX . md5( strtolower( $email ) ), $record, self::OTP_TTL );

		return $otp;
	}

	/**
	 * Verify a submitted OTP for the email. Enforces attempt cap + expiry and is
	 * single-use (the record is deleted on success).
	 *
	 * @param string $email Email (already sanitized/lowercased).
	 * @param string $otp   Submitted OTP.
	 * @return bool True on a valid, unexpired, within-attempts match.
	 */
	public static function verify_otp( $email, $otp ) {
		$key    = self::OTP_PREFIX . md5( strtolower( $email ) );
		$record = get_transient( $key );

		if ( ! is_array( $record ) || empty( $record['hash'] ) ) {
			return false;
		}

		// Attempt cap reached: burn it.
		if ( (int) $record['attempts'] >= self::OTP_MAX_ATTEMPTS ) {
			delete_transient( $key );
			return false;
		}

		$otp = preg_replace( '/\D/', '', (string) $otp );

		if ( wp_check_password( $otp, $record['hash'] ) ) {
			delete_transient( $key ); // Single use.
			return true;
		}

		// Record the failed attempt, preserving remaining TTL as best we can.
		$record['attempts'] = (int) $record['attempts'] + 1;
		$elapsed            = time() - (int) $record['created'];
		$remaining          = self::OTP_TTL - $elapsed;
		if ( $remaining < 1 ) {
			delete_transient( $key );
		} else {
			set_transient( $key, $record, $remaining );
		}

		return false;
	}

	/* ---------------------------------------------------------------------
	 * Sessions
	 * ------------------------------------------------------------------- */

	/**
	 * Create a session token bound to an email with a 2-hour TTL.
	 *
	 * @param string $email Email (already sanitized/lowercased).
	 * @return string The opaque session token.
	 */
	public static function create_session( $email ) {
		// 64 chars of URL-safe randomness (>= 48 required).
		$token = wp_generate_password( 64, false, false );
		set_transient( self::SESS_PREFIX . $token, strtolower( $email ), self::SESSION_TTL );
		return $token;
	}

	/**
	 * Resolve the email for a session token, or null if invalid/expired.
	 *
	 * @param string $token Session token.
	 * @return string|null
	 */
	public static function email_for_token( $token ) {
		$token = trim( (string) $token );
		if ( '' === $token ) {
			return null;
		}
		$email = get_transient( self::SESS_PREFIX . $token );
		if ( ! is_string( $email ) || '' === $email ) {
			return null;
		}
		return $email;
	}

	/**
	 * Destroy a session token.
	 *
	 * @param string $token Session token.
	 * @return void
	 */
	public static function destroy_session( $token ) {
		$token = trim( (string) $token );
		if ( '' !== $token ) {
			delete_transient( self::SESS_PREFIX . $token );
		}
	}

	/* ---------------------------------------------------------------------
	 * Request helpers
	 * ------------------------------------------------------------------- */

	/**
	 * Extract the Bearer token from a REST request's Authorization header.
	 *
	 * @param WP_REST_Request $request The request.
	 * @return string Empty string when absent/malformed.
	 */
	public static function bearer_token( WP_REST_Request $request ) {
		$header = (string) $request->get_header( 'authorization' );
		if ( '' === $header ) {
			return '';
		}
		if ( preg_match( '/Bearer\s+(.+)/i', $header, $m ) ) {
			return trim( $m[1] );
		}
		return '';
	}

	/**
	 * Resolve the authenticated email for a request: a valid Bearer session token
	 * whose email is STILL on the allowlist. Returns null otherwise.
	 *
	 * Use as the basis for management permission callbacks.
	 *
	 * @param WP_REST_Request $request The request.
	 * @return string|null
	 */
	public static function current_email_for_request( WP_REST_Request $request ) {
		$token = self::bearer_token( $request );
		if ( '' === $token ) {
			return null;
		}
		$email = self::email_for_token( $token );
		if ( null === $email ) {
			return null;
		}
		// Allowlist may have changed since login; re-check every request.
		if ( ! self::is_allowed( $email ) ) {
			return null;
		}
		return $email;
	}

	/* ---------------------------------------------------------------------
	 * "Manage Access" admin page
	 * ------------------------------------------------------------------- */

	/**
	 * Register the "Manage Access" submenu under the MCP Catalog menu.
	 *
	 * @return void
	 */
	public static function add_menu() {
		add_submenu_page(
			'edit.php?post_type=' . AISG_MCP_CATALOG_CPT,
			__( 'Manage Access', 'mcp-catalog' ),
			__( 'Manage Access', 'mcp-catalog' ),
			'manage_options',
			self::PAGE_SLUG,
			array( __CLASS__, 'render_page' )
		);
	}

	/**
	 * URL of this admin page.
	 *
	 * @return string
	 */
	protected static function page_url() {
		return add_query_arg(
			array(
				'post_type' => AISG_MCP_CATALOG_CPT,
				'page'      => self::PAGE_SLUG,
			),
			admin_url( 'edit.php' )
		);
	}

	/**
	 * Handle saving the allowlist textarea (one email per line).
	 *
	 * @return void
	 */
	public static function handle_save_allowlist() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'mcp-catalog' ) );
		}
		check_admin_referer( 'aisg_mcp_save_allowlist' );

		$raw   = isset( $_POST['allowlist'] ) ? (string) wp_unslash( $_POST['allowlist'] ) : '';
		$lines = preg_split( '/\r\n|\r|\n/', $raw );

		$emails = array();
		foreach ( $lines as $line ) {
			$email = sanitize_email( trim( $line ) );
			if ( '' === $email || ! is_email( $email ) ) {
				continue;
			}
			$email            = strtolower( $email );
			$emails[ $email ] = true; // De-dupe.
		}

		update_option( self::OPT_ALLOWLIST, array_keys( $emails ) );

		wp_safe_redirect( add_query_arg( 'updated', 'allowlist', self::page_url() ) );
		exit;
	}

	/**
	 * Render the "Manage Access" page.
	 *
	 * @return void
	 */
	public static function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$emails  = self::get_allowlist();
		$value   = implode( "\n", $emails );
		$updated = isset( $_GET['updated'] ) ? sanitize_key( wp_unslash( $_GET['updated'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'MCP Catalog — Manage Access', 'mcp-catalog' ); ?></h1>

			<?php if ( 'allowlist' === $updated ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Allowlist saved.', 'mcp-catalog' ); ?></p></div>
			<?php endif; ?>

			<p><?php esc_html_e( 'Email addresses listed here may sign in to the MCP Manager desktop app (via a one-time code sent to their inbox) and manage catalog entries. WordPress administrators always manage the catalog from this admin area regardless of this list.', 'mcp-catalog' ); ?></p>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="aisg_mcp_save_allowlist" />
				<?php wp_nonce_field( 'aisg_mcp_save_allowlist' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="aisg-mcp-allowlist"><?php esc_html_e( 'Allowed emails', 'mcp-catalog' ); ?></label></th>
						<td>
							<textarea id="aisg-mcp-allowlist" name="allowlist" rows="12" class="large-text code" placeholder="alice@aisingapore.org&#10;bob@aisingapore.org"><?php echo esc_textarea( $value ); ?></textarea>
							<p class="description"><?php esc_html_e( 'One email per line. Invalid entries are dropped on save; duplicates are merged and addresses are lowercased.', 'mcp-catalog' ); ?></p>
						</td>
					</tr>
				</table>
				<?php submit_button( __( 'Save allowlist', 'mcp-catalog' ) ); ?>
			</form>
		</div>
		<?php
	}
}

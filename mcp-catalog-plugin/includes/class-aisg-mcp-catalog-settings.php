<?php
/**
 * API Access admin page: shows the catalog endpoint URL and API key, lets the
 * admin regenerate the key, and optionally require the key on the endpoint.
 *
 * @package AISG_MCP_Catalog
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class AISG_MCP_Catalog_Settings
 */
class AISG_MCP_Catalog_Settings {

	const OPT_KEY     = 'aisg_mcp_catalog_api_key';
	const OPT_REQUIRE = 'aisg_mcp_catalog_require_key';
	const PAGE_SLUG   = 'mcp-catalog-api';

	/**
	 * Hook admin menu + form handlers.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'add_menu' ) );
		add_action( 'admin_post_aisg_mcp_regenerate_key', array( __CLASS__, 'handle_regenerate' ) );
		add_action( 'admin_post_aisg_mcp_save_settings', array( __CLASS__, 'handle_save_settings' ) );
	}

	/**
	 * Get the API key, generating and persisting one if it does not exist yet.
	 *
	 * @return string
	 */
	public static function get_api_key() {
		$key = get_option( self::OPT_KEY );
		if ( empty( $key ) ) {
			$key = self::generate_key();
			update_option( self::OPT_KEY, $key );
		}
		return (string) $key;
	}

	/**
	 * Generate a fresh API key.
	 *
	 * @return string
	 */
	public static function generate_key() {
		return 'mcpcat_' . wp_generate_password( 40, false, false );
	}

	/**
	 * Whether the endpoint should require the API key.
	 *
	 * @return bool
	 */
	public static function require_key() {
		return (bool) get_option( self::OPT_REQUIRE, false );
	}

	/**
	 * The public catalog endpoint URL.
	 *
	 * @return string
	 */
	public static function endpoint_url() {
		return rest_url( AISG_MCP_CATALOG_REST_NS . '/catalog' );
	}

	/**
	 * The endpoint URL with the API key as a query param (ready to paste).
	 *
	 * @return string
	 */
	public static function endpoint_url_with_key() {
		return add_query_arg( 'api_key', self::get_api_key(), self::endpoint_url() );
	}

	/**
	 * Register the "API Access" submenu under the MCP Catalog menu.
	 *
	 * @return void
	 */
	public static function add_menu() {
		add_submenu_page(
			'edit.php?post_type=' . AISG_MCP_CATALOG_CPT,
			__( 'API Access', 'mcp-catalog' ),
			__( 'API Access', 'mcp-catalog' ),
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
	 * Handle the "Regenerate key" action.
	 *
	 * @return void
	 */
	public static function handle_regenerate() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'mcp-catalog' ) );
		}
		check_admin_referer( 'aisg_mcp_regenerate_key' );
		update_option( self::OPT_KEY, self::generate_key() );
		wp_safe_redirect( add_query_arg( 'updated', 'key', self::page_url() ) );
		exit;
	}

	/**
	 * Handle saving the "require key" toggle.
	 *
	 * @return void
	 */
	public static function handle_save_settings() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'mcp-catalog' ) );
		}
		check_admin_referer( 'aisg_mcp_save_settings' );
		update_option( self::OPT_REQUIRE, isset( $_POST['require_key'] ) ? 1 : 0 );
		wp_safe_redirect( add_query_arg( 'updated', 'settings', self::page_url() ) );
		exit;
	}

	/**
	 * Render the API Access page.
	 *
	 * @return void
	 */
	public static function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$endpoint   = self::endpoint_url();
		$key        = self::get_api_key();
		$full_url   = self::endpoint_url_with_key();
		$require    = self::require_key();
		$updated    = isset( $_GET['updated'] ) ? sanitize_key( wp_unslash( $_GET['updated'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended

		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'MCP Catalog — API Access', 'mcp-catalog' ); ?></h1>

			<?php if ( 'key' === $updated ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'A new API key was generated.', 'mcp-catalog' ); ?></p></div>
			<?php elseif ( 'settings' === $updated ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Settings saved.', 'mcp-catalog' ); ?></p></div>
			<?php endif; ?>

			<p><?php esc_html_e( 'Use these in the MCP Manager desktop app to load this catalog. Paste the "Endpoint URL (with key)" if the endpoint requires a key, otherwise the plain Endpoint URL.', 'mcp-catalog' ); ?></p>

			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><?php esc_html_e( 'Endpoint URL', 'mcp-catalog' ); ?></th>
					<td>
						<input type="text" class="large-text code" readonly value="<?php echo esc_attr( $endpoint ); ?>" onclick="this.select();" />
						<p class="description"><?php esc_html_e( 'The public catalog endpoint.', 'mcp-catalog' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'API Key', 'mcp-catalog' ); ?></th>
					<td>
						<input type="text" class="large-text code" readonly value="<?php echo esc_attr( $key ); ?>" onclick="this.select();" />
						<p class="description"><?php esc_html_e( 'Send as the X-API-Key header, or as the ?api_key= query parameter.', 'mcp-catalog' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Endpoint URL (with key)', 'mcp-catalog' ); ?></th>
					<td>
						<input type="text" class="large-text code" readonly value="<?php echo esc_attr( $full_url ); ?>" onclick="this.select();" />
						<p class="description"><?php esc_html_e( 'Ready to paste — the key is included as a query parameter.', 'mcp-catalog' ); ?></p>
					</td>
				</tr>
			</table>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin-top:8px;">
				<input type="hidden" name="action" value="aisg_mcp_regenerate_key" />
				<?php wp_nonce_field( 'aisg_mcp_regenerate_key' ); ?>
				<?php submit_button( __( 'Regenerate API key', 'mcp-catalog' ), 'secondary', 'submit', false ); ?>
				<span class="description" style="margin-left:8px;"><?php esc_html_e( 'Any app using the old key will need the new one.', 'mcp-catalog' ); ?></span>
			</form>

			<hr />

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="aisg_mcp_save_settings" />
				<?php wp_nonce_field( 'aisg_mcp_save_settings' ); ?>
				<h2><?php esc_html_e( 'Access control', 'mcp-catalog' ); ?></h2>
				<label>
					<input type="checkbox" name="require_key" value="1" <?php checked( $require ); ?> />
					<?php esc_html_e( 'Require the API key to read the catalog endpoint', 'mcp-catalog' ); ?>
				</label>
				<p class="description"><?php esc_html_e( 'When off, the catalog is publicly readable (it contains no secrets — only {token} placeholders). When on, requests without a valid key get a 401.', 'mcp-catalog' ); ?></p>
				<?php submit_button( __( 'Save', 'mcp-catalog' ) ); ?>
			</form>
		</div>
		<?php
	}
}

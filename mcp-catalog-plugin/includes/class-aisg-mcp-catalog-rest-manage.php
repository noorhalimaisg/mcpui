<?php
/**
 * Authenticated REST surface: OTP login flow + management CRUD for the catalog.
 *
 * Namespace: mcp-catalog/v1
 *
 * Public auth routes:
 *   POST /auth/request-otp   { email }
 *   POST /auth/verify-otp    { email, otp }
 *   POST /auth/logout        (Authorization: Bearer <token>)
 *
 * Management routes (require a valid Bearer session whose email is on the allowlist):
 *   GET    /manage/catalog
 *   POST   /manage/catalog
 *   PUT    /manage/catalog/<id>
 *   DELETE /manage/catalog/<id>
 *
 * @package AISG_MCP_Catalog
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class AISG_MCP_Catalog_REST_Manage
 */
class AISG_MCP_Catalog_REST_Manage {

	/**
	 * Hook route registration.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	/**
	 * Register all auth + management routes.
	 *
	 * @return void
	 */
	public static function register_routes() {
		$ns = AISG_MCP_CATALOG_REST_NS;

		// --- Auth (public) ---
		register_rest_route(
			$ns,
			'/auth/request-otp',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'request_otp' ),
				'permission_callback' => '__return_true',
			)
		);
		register_rest_route(
			$ns,
			'/auth/verify-otp',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'verify_otp' ),
				'permission_callback' => '__return_true',
			)
		);
		register_rest_route(
			$ns,
			'/auth/logout',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'logout' ),
				'permission_callback' => '__return_true',
			)
		);

		// --- Management (require valid session) ---
		register_rest_route(
			$ns,
			'/manage/catalog',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( __CLASS__, 'list_catalog' ),
					'permission_callback' => array( __CLASS__, 'require_session' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( __CLASS__, 'create_item' ),
					'permission_callback' => array( __CLASS__, 'require_session' ),
				),
			)
		);
		register_rest_route(
			$ns,
			'/manage/catalog/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::EDITABLE, // PUT/PATCH/POST.
					'callback'            => array( __CLASS__, 'update_item' ),
					'permission_callback' => array( __CLASS__, 'require_session' ),
					'args'                => array(
						'id' => array(
							'validate_callback' => static function ( $value ) {
								return is_numeric( $value );
							},
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( __CLASS__, 'delete_item' ),
					'permission_callback' => array( __CLASS__, 'require_session' ),
					'args'                => array(
						'id' => array(
							'validate_callback' => static function ( $value ) {
								return is_numeric( $value );
							},
						),
					),
				),
			)
		);
	}

	/* ---------------------------------------------------------------------
	 * Permission callback
	 * ------------------------------------------------------------------- */

	/**
	 * Require a valid Bearer session whose email is still on the allowlist.
	 *
	 * @param WP_REST_Request $request The request.
	 * @return true|WP_Error
	 */
	public static function require_session( WP_REST_Request $request ) {
		$email = AISG_MCP_Catalog_Auth::current_email_for_request( $request );
		if ( null === $email ) {
			return new WP_Error(
				'rest_unauthorized',
				__( 'A valid session token is required.', 'mcp-catalog' ),
				array( 'status' => 401 )
			);
		}
		return true;
	}

	/* ---------------------------------------------------------------------
	 * Auth endpoints
	 * ------------------------------------------------------------------- */

	/**
	 * POST /auth/request-otp — issue an OTP to an allowlisted email.
	 *
	 * @param WP_REST_Request $request The request.
	 * @return WP_REST_Response
	 */
	public static function request_otp( WP_REST_Request $request ) {
		$email = sanitize_email( (string) $request->get_param( 'email' ) );

		if ( '' === $email || ! is_email( $email ) ) {
			return new WP_REST_Response( array( 'allowed' => false, 'sent' => false ), 200 );
		}
		$email = strtolower( $email );

		// Rate limit regardless of allowlist membership to avoid enumeration/abuse.
		if ( AISG_MCP_Catalog_Auth::is_rate_limited( $email ) ) {
			return new WP_REST_Response( array( 'error' => 'rate_limited' ), 429 );
		}
		AISG_MCP_Catalog_Auth::bump_rate( $email );

		if ( ! AISG_MCP_Catalog_Auth::is_allowed( $email ) ) {
			return new WP_REST_Response( array( 'allowed' => false, 'sent' => false ), 200 );
		}

		$otp = AISG_MCP_Catalog_Auth::issue_otp( $email );

		$subject = __( 'Your MCP Catalog verification code', 'mcp-catalog' );
		$body    = sprintf(
			/* translators: 1: 6-digit code, 2: minutes until expiry. */
			__( "Your MCP Catalog verification code is: %1\$s\n\nThis code expires in %2\$d minutes. If you did not request it, you can ignore this email.", 'mcp-catalog' ),
			$otp,
			(int) ( AISG_MCP_Catalog_Auth::OTP_TTL / 60 )
		);
		wp_mail( $email, $subject, $body );

		return new WP_REST_Response( array( 'allowed' => true, 'sent' => true ), 200 );
	}

	/**
	 * POST /auth/verify-otp — verify an OTP and mint a session token.
	 *
	 * @param WP_REST_Request $request The request.
	 * @return WP_REST_Response
	 */
	public static function verify_otp( WP_REST_Request $request ) {
		$email = strtolower( sanitize_email( (string) $request->get_param( 'email' ) ) );
		$otp   = preg_replace( '/\D/', '', (string) $request->get_param( 'otp' ) );

		$fail = new WP_REST_Response( array( 'ok' => false, 'error' => 'invalid_or_expired' ), 401 );

		if ( '' === $email || ! is_email( $email ) || '' === $otp ) {
			return $fail;
		}

		// Allowlist could have changed since the OTP was issued.
		if ( ! AISG_MCP_Catalog_Auth::is_allowed( $email ) ) {
			return $fail;
		}

		if ( ! AISG_MCP_Catalog_Auth::verify_otp( $email, $otp ) ) {
			return $fail;
		}

		$token = AISG_MCP_Catalog_Auth::create_session( $email );

		return new WP_REST_Response(
			array(
				'ok'        => true,
				'token'     => $token,
				'email'     => $email,
				'expiresIn' => AISG_MCP_Catalog_Auth::SESSION_TTL,
			),
			200
		);
	}

	/**
	 * POST /auth/logout — destroy the current session token.
	 *
	 * @param WP_REST_Request $request The request.
	 * @return WP_REST_Response
	 */
	public static function logout( WP_REST_Request $request ) {
		$token = AISG_MCP_Catalog_Auth::bearer_token( $request );
		AISG_MCP_Catalog_Auth::destroy_session( $token );
		return new WP_REST_Response( array( 'ok' => true ), 200 );
	}

	/* ---------------------------------------------------------------------
	 * Management endpoints
	 * ------------------------------------------------------------------- */

	/**
	 * GET /manage/catalog — list all entries (incl. drafts) with IDs.
	 *
	 * @param WP_REST_Request $request The request.
	 * @return WP_REST_Response
	 */
	public static function list_catalog( WP_REST_Request $request ) {
		return new WP_REST_Response(
			array(
				'ok'    => true,
				'items' => AISG_MCP_Catalog_Store::get_all_entries(),
			),
			200
		);
	}

	/**
	 * POST /manage/catalog — create a published entry.
	 *
	 * @param WP_REST_Request $request The request.
	 * @return WP_REST_Response
	 */
	public static function create_item( WP_REST_Request $request ) {
		$email  = AISG_MCP_Catalog_Auth::current_email_for_request( $request );
		$fields = AISG_MCP_Catalog_Store::sanitize_entry_input( self::body( $request ) );

		$post_id = AISG_MCP_Catalog_Store::create_entry( $fields );
		if ( is_wp_error( $post_id ) ) {
			return new WP_REST_Response( array( 'ok' => false, 'error' => 'create_failed' ), 500 );
		}

		$entry = AISG_MCP_Catalog_Store::get_entry( $post_id );
		AISG_MCP_Catalog_Store::record_change( $email, 'create', $entry['name'], $post_id );

		return new WP_REST_Response( array( 'ok' => true, 'item' => $entry ), 201 );
	}

	/**
	 * PUT /manage/catalog/<id> — update an entry.
	 *
	 * @param WP_REST_Request $request The request.
	 * @return WP_REST_Response
	 */
	public static function update_item( WP_REST_Request $request ) {
		$id   = absint( $request['id'] );
		$post = AISG_MCP_Catalog_Store::get_catalog_post( $id );
		if ( null === $post ) {
			return new WP_REST_Response( array( 'ok' => false, 'error' => 'not_found' ), 404 );
		}

		$email  = AISG_MCP_Catalog_Auth::current_email_for_request( $request );
		$fields = AISG_MCP_Catalog_Store::sanitize_entry_input( self::body( $request ) );

		$result = AISG_MCP_Catalog_Store::update_entry( $id, $fields );
		if ( is_wp_error( $result ) ) {
			return new WP_REST_Response( array( 'ok' => false, 'error' => 'update_failed' ), 500 );
		}

		$entry = AISG_MCP_Catalog_Store::get_entry( $id );
		AISG_MCP_Catalog_Store::record_change( $email, 'update', $entry['name'], $id );

		return new WP_REST_Response( array( 'ok' => true, 'item' => $entry ), 200 );
	}

	/**
	 * DELETE /manage/catalog/<id> — permanently delete an entry.
	 *
	 * @param WP_REST_Request $request The request.
	 * @return WP_REST_Response
	 */
	public static function delete_item( WP_REST_Request $request ) {
		$id   = absint( $request['id'] );
		$post = AISG_MCP_Catalog_Store::get_catalog_post( $id );
		if ( null === $post ) {
			return new WP_REST_Response( array( 'ok' => false, 'error' => 'not_found' ), 404 );
		}

		$email = AISG_MCP_Catalog_Auth::current_email_for_request( $request );
		$entry = AISG_MCP_Catalog_Store::get_entry( $id );

		if ( ! AISG_MCP_Catalog_Store::delete_entry( $id ) ) {
			return new WP_REST_Response( array( 'ok' => false, 'error' => 'delete_failed' ), 500 );
		}

		AISG_MCP_Catalog_Store::record_change( $email, 'delete', $entry['name'], $id );

		return new WP_REST_Response( array( 'ok' => true ), 200 );
	}

	/* ---------------------------------------------------------------------
	 * Helpers
	 * ------------------------------------------------------------------- */

	/**
	 * Read the request body as an associative array (JSON or form params).
	 *
	 * @param WP_REST_Request $request The request.
	 * @return array
	 */
	protected static function body( WP_REST_Request $request ) {
		$json = $request->get_json_params();
		if ( is_array( $json ) && ! empty( $json ) ) {
			return $json;
		}
		$params = $request->get_body_params();
		return is_array( $params ) ? $params : array();
	}
}

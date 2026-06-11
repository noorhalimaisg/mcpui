<?php
/**
 * Public, read-only REST endpoint that serves the MCP catalog.
 *
 * @package AISG_MCP_Catalog
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class AISG_MCP_Catalog_REST
 *
 * Registers GET /wp-json/mcp-catalog/v1/catalog and returns a JSON array of entries.
 */
class AISG_MCP_Catalog_REST {

	/**
	 * Hook REST route registration.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	/**
	 * Register the public catalog route.
	 *
	 * @return void
	 */
	public static function register_routes() {
		register_rest_route(
			AISG_MCP_CATALOG_REST_NS,
			'/catalog',
			array(
				'methods'             => WP_REST_Server::READABLE, // GET only.
				'callback'            => array( __CLASS__, 'get_catalog' ),
				// Public, non-secret catalog: read access is open by design.
				'permission_callback' => array( __CLASS__, 'check_permission' ),
			)
		);
	}

	/**
	 * Permission check. Public unless "Require API key" is enabled, in which case
	 * a valid key must arrive via the X-API-Key header or the api_key query param.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return bool|WP_Error
	 */
	public static function check_permission( WP_REST_Request $request ) {
		if ( ! AISG_MCP_Catalog_Settings::require_key() ) {
			return true;
		}
		$provided = $request->get_header( 'X-API-Key' );
		if ( empty( $provided ) ) {
			$provided = $request->get_param( 'api_key' );
		}
		$expected = AISG_MCP_Catalog_Settings::get_api_key();
		if ( ! empty( $provided ) && hash_equals( $expected, (string) $provided ) ) {
			return true;
		}
		return new WP_Error(
			'rest_forbidden',
			__( 'A valid API key is required to read this catalog.', 'mcp-catalog' ),
			array( 'status' => 401 )
		);
	}

	/**
	 * Build and return the catalog as a JSON array of entries.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response
	 */
	public static function get_catalog( WP_REST_Request $request ) {
		$query = new WP_Query(
			array(
				'post_type'              => AISG_MCP_CATALOG_CPT,
				'post_status'            => 'publish', // Skip drafts/private/trash.
				'posts_per_page'         => -1,
				'orderby'                => 'title',
				'order'                  => 'ASC',
				'no_found_rows'          => true,
				'update_post_term_cache' => false,
				'suppress_filters'       => false,
			)
		);

		$entries   = array();
		$seen_keys = array();

		foreach ( $query->posts as $post ) {
			$entry = self::map_post_to_entry( $post );

			// Enforce unique `name` across entries; skip empties and duplicates after the first.
			if ( '' === $entry['name'] || isset( $seen_keys[ $entry['name'] ] ) ) {
				continue;
			}
			$seen_keys[ $entry['name'] ] = true;

			$entries[] = $entry;
		}

		/**
		 * Filter the full catalog array before it is returned.
		 *
		 * @param array $entries Array of catalog entries.
		 */
		$entries = apply_filters( 'aisg_mcp_catalog_entries', $entries );

		// Return as a top-level JSON array with explicit application/json content type.
		$response = new WP_REST_Response( array_values( $entries ), 200 );
		$response->header( 'Content-Type', 'application/json; charset=' . get_option( 'blog_charset' ) );

		return $response;
	}

	/**
	 * Map a single CPT post into the catalog entry schema.
	 *
	 * @param WP_Post $post Catalog post.
	 * @return array Entry with exactly the required schema keys.
	 */
	protected static function map_post_to_entry( $post ) {
		$name = (string) get_post_meta( $post->ID, AISG_MCP_Catalog_Meta::META_NAME, true );
		if ( '' === $name ) {
			$name = sanitize_title( $post->post_title );
		}

		// Description: use post content (the editor) rendered to plain-ish text.
		$description = (string) $post->post_content;
		$description = wp_strip_all_tags( $description );
		$description = trim( $description );

		$author = (string) get_post_meta( $post->ID, AISG_MCP_Catalog_Meta::META_AUTHOR, true );

		$icon = (string) get_post_meta( $post->ID, AISG_MCP_Catalog_Meta::META_ICON, true );

		$command = (string) get_post_meta( $post->ID, AISG_MCP_Catalog_Meta::META_COMMAND, true );
		if ( '' === $command ) {
			$command = 'npx';
		}

		// Args: stored as one-per-line string; split into a real array of strings.
		$args_raw = (string) get_post_meta( $post->ID, AISG_MCP_Catalog_Meta::META_ARGS, true );
		$args     = self::split_args( $args_raw );

		$requires_token = (bool) get_post_meta( $post->ID, AISG_MCP_Catalog_Meta::META_REQUIRES_TOKEN, true );

		$token_hint = (string) get_post_meta( $post->ID, AISG_MCP_Catalog_Meta::META_TOKEN_HINT, true );

		$entry = array(
			'name'          => $name,
			'title'         => (string) get_the_title( $post ),
			'description'   => $description,
			'author'        => $author,
			'icon'          => $icon,
			'command'       => $command,
			'args'          => $args,
			'requiresToken' => $requires_token,
			'tokenHint'     => $token_hint,
		);

		/**
		 * Filter a single catalog entry before it is added to the response.
		 *
		 * @param array   $entry The entry array.
		 * @param WP_Post $post  The source post.
		 */
		return apply_filters( 'aisg_mcp_catalog_entry', $entry, $post );
	}

	/**
	 * Split a one-argument-per-line string into a clean array of strings.
	 *
	 * Preserves the literal {token} placeholder. Trims trailing whitespace and
	 * drops fully empty lines, but keeps argument order intact.
	 *
	 * @param string $raw Raw multi-line args value.
	 * @return string[] Array of argument strings.
	 */
	protected static function split_args( $raw ) {
		if ( '' === trim( (string) $raw ) ) {
			return array();
		}

		$lines = preg_split( '/\r\n|\r|\n/', $raw );
		$args  = array();

		foreach ( $lines as $line ) {
			$line = rtrim( $line );
			// Skip blank lines (but keep meaningful interior whitespace within a line).
			if ( '' === trim( $line ) ) {
				continue;
			}
			$args[] = $line;
		}

		return $args;
	}
}

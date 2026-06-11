<?php
/**
 * Registers the MCP Catalog custom post type.
 *
 * @package AISG_MCP_Catalog
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class AISG_MCP_Catalog_CPT
 *
 * Defines the admin-only `mcp_catalog` custom post type that backs the catalog.
 */
class AISG_MCP_Catalog_CPT {

	/**
	 * Hook the CPT registration.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'init', array( __CLASS__, 'register_post_type' ) );
	}

	/**
	 * Register the `mcp_catalog` custom post type.
	 *
	 * Admin-managed only (not publicly queryable on the front end), but the data is
	 * surfaced publicly through the REST endpoint in AISG_MCP_Catalog_REST.
	 *
	 * @return void
	 */
	public static function register_post_type() {
		$labels = array(
			'name'               => _x( 'MCP Catalog', 'post type general name', 'mcp-catalog' ),
			'singular_name'      => _x( 'MCP Entry', 'post type singular name', 'mcp-catalog' ),
			'menu_name'          => _x( 'MCP Catalog', 'admin menu', 'mcp-catalog' ),
			'name_admin_bar'     => _x( 'MCP Entry', 'add new on admin bar', 'mcp-catalog' ),
			'add_new'            => __( 'Add New', 'mcp-catalog' ),
			'add_new_item'       => __( 'Add New MCP Entry', 'mcp-catalog' ),
			'new_item'           => __( 'New MCP Entry', 'mcp-catalog' ),
			'edit_item'          => __( 'Edit MCP Entry', 'mcp-catalog' ),
			'view_item'          => __( 'View MCP Entry', 'mcp-catalog' ),
			'all_items'          => __( 'All MCP Entries', 'mcp-catalog' ),
			'search_items'       => __( 'Search MCP Entries', 'mcp-catalog' ),
			'not_found'          => __( 'No MCP entries found.', 'mcp-catalog' ),
			'not_found_in_trash' => __( 'No MCP entries found in Trash.', 'mcp-catalog' ),
		);

		$args = array(
			'labels'              => $labels,
			'public'              => false,
			'publicly_queryable'  => false,
			'show_ui'             => true,
			'show_in_menu'        => true,
			'show_in_rest'        => false, // We expose a custom, schema-stable REST route instead.
			'query_var'           => false,
			'rewrite'             => false,
			'capability_type'     => 'post',
			'has_archive'         => false,
			'hierarchical'        => false,
			'menu_position'       => 30,
			'menu_icon'           => 'dashicons-cloud',
			'exclude_from_search' => true,
			// 'title' = MCP display name; 'editor' reused as the description.
			'supports'            => array( 'title', 'editor' ),
		);

		/**
		 * Allow other plugins/themes to adjust the CPT registration args.
		 *
		 * @param array $args The register_post_type arguments.
		 */
		$args = apply_filters( 'aisg_mcp_catalog_cpt_args', $args );

		register_post_type( AISG_MCP_CATALOG_CPT, $args );
	}
}

<?php
/**
 * Plugin Name:       MCP Catalog
 * Plugin URI:        https://aisingapore.org/
 * Description:        Publishes a public, read-only catalog of MCP servers via a REST endpoint, consumed by the MCP Manager desktop app. Includes an admin UI to manage catalog entries.
 * Version:           1.2.0
 * Requires at least: 5.6
 * Requires PHP:      7.4
 * Author:            Halim, Platform Engineering — AI Singapore
 * Author URI:        https://aisingapore.org/
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       mcp-catalog
 * Domain Path:       /languages
 *
 * @package AISG_MCP_Catalog
 */

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Plugin constants.
 */
define( 'AISG_MCP_CATALOG_VERSION', '1.2.0' );
define( 'AISG_MCP_CATALOG_FILE', __FILE__ );
define( 'AISG_MCP_CATALOG_DIR', plugin_dir_path( __FILE__ ) );
define( 'AISG_MCP_CATALOG_URL', plugin_dir_url( __FILE__ ) );
define( 'AISG_MCP_CATALOG_CPT', 'mcp_catalog' );
define( 'AISG_MCP_CATALOG_REST_NS', 'mcp-catalog/v1' );

// Load components.
require_once AISG_MCP_CATALOG_DIR . 'includes/class-aisg-mcp-catalog-cpt.php';
require_once AISG_MCP_CATALOG_DIR . 'includes/class-aisg-mcp-catalog-meta.php';
require_once AISG_MCP_CATALOG_DIR . 'includes/class-aisg-mcp-catalog-settings.php';
require_once AISG_MCP_CATALOG_DIR . 'includes/class-aisg-mcp-catalog-rest.php';
require_once AISG_MCP_CATALOG_DIR . 'includes/class-aisg-mcp-catalog-auth.php';
require_once AISG_MCP_CATALOG_DIR . 'includes/class-aisg-mcp-catalog-store.php';
require_once AISG_MCP_CATALOG_DIR . 'includes/class-aisg-mcp-catalog-rest-manage.php';
require_once AISG_MCP_CATALOG_DIR . 'includes/class-aisg-mcp-catalog-history.php';

/**
 * Bootstrap the plugin.
 *
 * @return void
 */
function aisg_mcp_catalog_bootstrap() {
	AISG_MCP_Catalog_CPT::init();
	AISG_MCP_Catalog_Meta::init();
	AISG_MCP_Catalog_Settings::init();
	AISG_MCP_Catalog_REST::init();
	AISG_MCP_Catalog_Auth::init();
	AISG_MCP_Catalog_REST_Manage::init();
	AISG_MCP_Catalog_History::init();
}
add_action( 'plugins_loaded', 'aisg_mcp_catalog_bootstrap' );

/**
 * Activation: register the CPT, ensure an API key exists, then flush rewrite
 * rules so the REST route resolves.
 *
 * @return void
 */
function aisg_mcp_catalog_activate() {
	AISG_MCP_Catalog_CPT::register_post_type();
	AISG_MCP_Catalog_Settings::get_api_key(); // generate & persist a key on first activation
	flush_rewrite_rules();
}
register_activation_hook( __FILE__, 'aisg_mcp_catalog_activate' );

/**
 * Deactivation: flush rewrite rules to clean up.
 *
 * @return void
 */
function aisg_mcp_catalog_deactivate() {
	flush_rewrite_rules();
}
register_deactivation_hook( __FILE__, 'aisg_mcp_catalog_deactivate' );

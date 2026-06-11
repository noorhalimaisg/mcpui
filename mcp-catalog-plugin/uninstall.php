<?php
/**
 * Uninstall handler for MCP Catalog.
 *
 * Removes all catalog posts (CPT) and their meta when the plugin is deleted from
 * WordPress. No options are created by this plugin, but we defensively clean any
 * that may have been added by extensions, plus the CPT posts/meta it owns.
 *
 * @package AISG_MCP_Catalog
 */

// Only run when WordPress invokes the uninstall lifecycle.
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

$aisg_mcp_catalog_cpt = 'mcp_catalog';

// Meta keys owned by this plugin (kept in sync with AISG_MCP_Catalog_Meta).
$aisg_mcp_catalog_meta_keys = array(
	'_aisg_mcp_name',
	'_aisg_mcp_author',
	'_aisg_mcp_icon',
	'_aisg_mcp_command',
	'_aisg_mcp_args',
	'_aisg_mcp_requires_token',
	'_aisg_mcp_token_hint',
);

// Delete all catalog posts (any status) and their attached meta.
$aisg_mcp_catalog_posts = get_posts(
	array(
		'post_type'              => $aisg_mcp_catalog_cpt,
		'post_status'            => 'any',
		'numberposts'            => -1,
		'fields'                 => 'ids',
		'suppress_filters'       => true,
		'update_post_term_cache' => false,
		'update_post_meta_cache' => false,
	)
);

if ( ! empty( $aisg_mcp_catalog_posts ) ) {
	foreach ( $aisg_mcp_catalog_posts as $aisg_mcp_catalog_post_id ) {
		foreach ( $aisg_mcp_catalog_meta_keys as $aisg_mcp_catalog_meta_key ) {
			delete_post_meta( $aisg_mcp_catalog_post_id, $aisg_mcp_catalog_meta_key );
		}
		// Force delete (bypass trash) so nothing lingers after uninstall.
		wp_delete_post( $aisg_mcp_catalog_post_id, true );
	}
}

// Remove plugin options.
delete_option( 'aisg_mcp_catalog_settings' );
delete_option( 'aisg_mcp_catalog_api_key' );
delete_option( 'aisg_mcp_catalog_require_key' );
delete_option( 'aisg_mcp_catalog_allowlist' );
delete_option( 'aisg_mcp_catalog_log' );
delete_option( 'aisg_mcp_catalog_snapshots' );

// Best-effort removal of OTP, session, and rate-limit transients created by the
// auth flow (mcpcat_otp_*, mcpcat_otp_rate_*, mcpcat_sess_*). Transients are
// stored as options unless an external object cache is in use.
global $wpdb;
$aisg_mcp_catalog_transient_prefixes = array(
	'mcpcat_otp_',
	'mcpcat_sess_',
);
foreach ( $aisg_mcp_catalog_transient_prefixes as $aisg_mcp_catalog_prefix ) {
	// phpcs:disable WordPress.DB.DirectDatabaseQuery
	$aisg_mcp_catalog_rows = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
			$wpdb->esc_like( '_transient_' . $aisg_mcp_catalog_prefix ) . '%',
			$wpdb->esc_like( '_transient_timeout_' . $aisg_mcp_catalog_prefix ) . '%'
		)
	);
	// phpcs:enable WordPress.DB.DirectDatabaseQuery

	if ( ! empty( $aisg_mcp_catalog_rows ) ) {
		foreach ( $aisg_mcp_catalog_rows as $aisg_mcp_catalog_option_name ) {
			// Translate the stored option name back into a transient key and delete it cleanly.
			if ( 0 === strpos( $aisg_mcp_catalog_option_name, '_transient_timeout_' ) ) {
				$aisg_mcp_catalog_key = substr( $aisg_mcp_catalog_option_name, strlen( '_transient_timeout_' ) );
			} else {
				$aisg_mcp_catalog_key = substr( $aisg_mcp_catalog_option_name, strlen( '_transient_' ) );
			}
			delete_transient( $aisg_mcp_catalog_key );
		}
	}
}

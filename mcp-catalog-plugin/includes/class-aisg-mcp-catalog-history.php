<?php
/**
 * "History & Rollback" admin page: shows the change log and lets an admin
 * restore the catalog to a previous snapshot.
 *
 * @package AISG_MCP_Catalog
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class AISG_MCP_Catalog_History
 */
class AISG_MCP_Catalog_History {

	const PAGE_SLUG = 'mcp-catalog-history';

	/**
	 * Hook admin menu + restore handler.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'add_menu' ) );
		add_action( 'admin_post_aisg_mcp_restore_snapshot', array( __CLASS__, 'handle_restore' ) );
	}

	/**
	 * Register the "History & Rollback" submenu.
	 *
	 * @return void
	 */
	public static function add_menu() {
		add_submenu_page(
			'edit.php?post_type=' . AISG_MCP_CATALOG_CPT,
			__( 'History & Rollback', 'mcp-catalog' ),
			__( 'History & Rollback', 'mcp-catalog' ),
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
	 * Handle the "Restore" action for a snapshot index.
	 *
	 * @return void
	 */
	public static function handle_restore() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'mcp-catalog' ) );
		}
		check_admin_referer( 'aisg_mcp_restore_snapshot' );

		$index = isset( $_POST['snapshot_index'] ) ? absint( wp_unslash( $_POST['snapshot_index'] ) ) : -1;

		$user  = wp_get_current_user();
		$email = $user ? strtolower( $user->user_email ) : '';

		$ok = AISG_MCP_Catalog_Store::restore_snapshot( $index, $email );

		wp_safe_redirect( add_query_arg( 'restored', $ok ? '1' : '0', self::page_url() ) );
		exit;
	}

	/**
	 * Render the History & Rollback page.
	 *
	 * @return void
	 */
	public static function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$log       = AISG_MCP_Catalog_Store::get_log();
		$snapshots = AISG_MCP_Catalog_Store::get_snapshots();
		$restored  = isset( $_GET['restored'] ) ? sanitize_key( wp_unslash( $_GET['restored'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'MCP Catalog — History & Rollback', 'mcp-catalog' ); ?></h1>

			<?php if ( '1' === $restored ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Catalog restored from the selected snapshot. The pre-restore state was saved as a new snapshot so you can undo this.', 'mcp-catalog' ); ?></p></div>
			<?php elseif ( '0' === $restored ) : ?>
				<div class="notice notice-error is-dismissible"><p><?php esc_html_e( 'Restore failed: the selected snapshot could not be found.', 'mcp-catalog' ); ?></p></div>
			<?php endif; ?>

			<h2><?php esc_html_e( 'Change log', 'mcp-catalog' ); ?></h2>
			<p class="description"><?php esc_html_e( 'Most recent catalog changes made through the management API or via rollback.', 'mcp-catalog' ); ?></p>
			<table class="widefat striped">
				<thead>
					<tr>
						<th><?php esc_html_e( 'Time (UTC)', 'mcp-catalog' ); ?></th>
						<th><?php esc_html_e( 'Actor', 'mcp-catalog' ); ?></th>
						<th><?php esc_html_e( 'Action', 'mcp-catalog' ); ?></th>
						<th><?php esc_html_e( 'Entry', 'mcp-catalog' ); ?></th>
					</tr>
				</thead>
				<tbody>
					<?php if ( empty( $log ) ) : ?>
						<tr><td colspan="4"><?php esc_html_e( 'No changes recorded yet.', 'mcp-catalog' ); ?></td></tr>
					<?php else : ?>
						<?php foreach ( $log as $row ) : ?>
							<tr>
								<td><?php echo esc_html( isset( $row['time'] ) ? $row['time'] : '' ); ?></td>
								<td><?php echo esc_html( isset( $row['email'] ) ? $row['email'] : '' ); ?></td>
								<td><code><?php echo esc_html( isset( $row['action'] ) ? $row['action'] : '' ); ?></code></td>
								<td>
									<?php
									echo esc_html( isset( $row['entry_name'] ) ? $row['entry_name'] : '' );
									if ( ! empty( $row['entry_id'] ) ) {
										echo ' <span class="description">(#' . esc_html( (string) $row['entry_id'] ) . ')</span>';
									}
									?>
								</td>
							</tr>
						<?php endforeach; ?>
					<?php endif; ?>
				</tbody>
			</table>

			<hr />

			<h2><?php esc_html_e( 'Snapshots', 'mcp-catalog' ); ?></h2>
			<p class="description"><?php esc_html_e( 'The last 15 full-catalog snapshots. Restoring replaces ALL current entries with the snapshot contents.', 'mcp-catalog' ); ?></p>
			<table class="widefat striped">
				<thead>
					<tr>
						<th><?php esc_html_e( 'Time (UTC)', 'mcp-catalog' ); ?></th>
						<th><?php esc_html_e( 'Actor', 'mcp-catalog' ); ?></th>
						<th><?php esc_html_e( 'Triggered by', 'mcp-catalog' ); ?></th>
						<th><?php esc_html_e( 'Entries', 'mcp-catalog' ); ?></th>
						<th><?php esc_html_e( 'Action', 'mcp-catalog' ); ?></th>
					</tr>
				</thead>
				<tbody>
					<?php if ( empty( $snapshots ) ) : ?>
						<tr><td colspan="5"><?php esc_html_e( 'No snapshots yet.', 'mcp-catalog' ); ?></td></tr>
					<?php else : ?>
						<?php foreach ( $snapshots as $index => $snapshot ) : ?>
							<tr>
								<td><?php echo esc_html( isset( $snapshot['time'] ) ? $snapshot['time'] : '' ); ?></td>
								<td><?php echo esc_html( isset( $snapshot['email'] ) ? $snapshot['email'] : '' ); ?></td>
								<td><code><?php echo esc_html( isset( $snapshot['action'] ) ? $snapshot['action'] : '' ); ?></code></td>
								<td><?php echo esc_html( (string) ( isset( $snapshot['entries'] ) && is_array( $snapshot['entries'] ) ? count( $snapshot['entries'] ) : 0 ) ); ?></td>
								<td>
									<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" onsubmit="return confirm('<?php echo esc_js( __( 'Restore the catalog to this snapshot? All current entries will be replaced.', 'mcp-catalog' ) ); ?>');" style="margin:0;">
										<input type="hidden" name="action" value="aisg_mcp_restore_snapshot" />
										<input type="hidden" name="snapshot_index" value="<?php echo esc_attr( (string) $index ); ?>" />
										<?php wp_nonce_field( 'aisg_mcp_restore_snapshot' ); ?>
										<?php submit_button( __( 'Restore', 'mcp-catalog' ), 'secondary', 'submit', false ); ?>
									</form>
								</td>
							</tr>
						<?php endforeach; ?>
					<?php endif; ?>
				</tbody>
			</table>
		</div>
		<?php
	}
}

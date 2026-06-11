<?php
/**
 * Catalog data store: shared CRUD, entry<->post mapping, change log, snapshots,
 * and rollback. Used by both the management REST endpoints and the admin
 * "History & Rollback" page so behaviour stays identical across surfaces.
 *
 * Entry shape (management variant — public schema PLUS `id`):
 *   id, name, title, description, author, icon, command, args (string[]),
 *   requiresToken (bool), tokenHint
 *
 * @package AISG_MCP_Catalog
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class AISG_MCP_Catalog_Store
 */
class AISG_MCP_Catalog_Store {

	const OPT_LOG       = 'aisg_mcp_catalog_log';
	const OPT_SNAPSHOTS = 'aisg_mcp_catalog_snapshots';

	const LOG_MAX      = 200;
	const SNAPSHOT_MAX = 15;

	/* ---------------------------------------------------------------------
	 * Reads
	 * ------------------------------------------------------------------- */

	/**
	 * All catalog posts (any status), mapped to management entries with `id`.
	 *
	 * @return array[] Array of entry arrays.
	 */
	public static function get_all_entries() {
		$posts = get_posts(
			array(
				'post_type'              => AISG_MCP_CATALOG_CPT,
				'post_status'            => 'any',
				'numberposts'            => -1,
				'orderby'                => 'title',
				'order'                  => 'ASC',
				'suppress_filters'       => true,
				'update_post_term_cache' => false,
			)
		);

		$entries = array();
		foreach ( $posts as $post ) {
			$entries[] = self::post_to_entry( $post );
		}
		return $entries;
	}

	/**
	 * Map a post to a management entry (public schema + `id`). Reuses the same
	 * meta keys and args-splitting semantics as the public endpoint.
	 *
	 * @param WP_Post $post Catalog post.
	 * @return array
	 */
	public static function post_to_entry( $post ) {
		$name = (string) get_post_meta( $post->ID, AISG_MCP_Catalog_Meta::META_NAME, true );
		if ( '' === $name ) {
			$name = sanitize_title( $post->post_title );
		}

		$description = trim( wp_strip_all_tags( (string) $post->post_content ) );

		$command = (string) get_post_meta( $post->ID, AISG_MCP_Catalog_Meta::META_COMMAND, true );
		if ( '' === $command ) {
			$command = 'npx';
		}

		return array(
			'id'            => (int) $post->ID,
			'name'          => $name,
			'title'         => (string) get_the_title( $post ),
			'description'   => $description,
			'author'        => (string) get_post_meta( $post->ID, AISG_MCP_Catalog_Meta::META_AUTHOR, true ),
			'icon'          => (string) get_post_meta( $post->ID, AISG_MCP_Catalog_Meta::META_ICON, true ),
			'command'       => $command,
			'args'          => self::split_args( (string) get_post_meta( $post->ID, AISG_MCP_Catalog_Meta::META_ARGS, true ) ),
			'requiresToken' => (bool) get_post_meta( $post->ID, AISG_MCP_Catalog_Meta::META_REQUIRES_TOKEN, true ),
			'tokenHint'     => (string) get_post_meta( $post->ID, AISG_MCP_Catalog_Meta::META_TOKEN_HINT, true ),
		);
	}

	/**
	 * Fetch a single entry by post ID, validating it is an mcp_catalog post.
	 *
	 * @param int $id Post ID.
	 * @return array|null Entry, or null when not a valid catalog post.
	 */
	public static function get_entry( $id ) {
		$post = self::get_catalog_post( $id );
		return $post ? self::post_to_entry( $post ) : null;
	}

	/**
	 * Return the post if it exists and is an mcp_catalog post, else null.
	 *
	 * @param int $id Post ID.
	 * @return WP_Post|null
	 */
	public static function get_catalog_post( $id ) {
		$id   = absint( $id );
		$post = $id ? get_post( $id ) : null;
		if ( ! $post || AISG_MCP_CATALOG_CPT !== $post->post_type ) {
			return null;
		}
		return $post;
	}

	/* ---------------------------------------------------------------------
	 * Writes (sanitizing CRUD)
	 * ------------------------------------------------------------------- */

	/**
	 * Sanitize a raw entry payload into a normalized field set.
	 *
	 * @param array $raw Raw input (associative array of entry fields).
	 * @return array Sanitized fields: name,title,description,author,icon,command,args(string[]),requiresToken(bool),tokenHint.
	 */
	public static function sanitize_entry_input( array $raw ) {
		$name        = isset( $raw['name'] ) ? sanitize_text_field( $raw['name'] ) : '';
		$title       = isset( $raw['title'] ) ? sanitize_text_field( $raw['title'] ) : '';
		$author      = isset( $raw['author'] ) ? sanitize_text_field( $raw['author'] ) : '';
		$command     = isset( $raw['command'] ) ? sanitize_text_field( $raw['command'] ) : '';
		$token_hint  = isset( $raw['tokenHint'] ) ? sanitize_text_field( $raw['tokenHint'] ) : '';
		$icon        = isset( $raw['icon'] ) ? esc_url_raw( $raw['icon'] ) : '';
		$description = isset( $raw['description'] ) ? sanitize_textarea_field( $raw['description'] ) : '';

		// Normalise the slug-like name the same way the meta box does.
		$name = sanitize_title( $name );

		if ( '' === $command ) {
			$command = 'npx';
		}

		// Args: accept a JSON array of strings; sanitize each element as text.
		$args = array();
		if ( isset( $raw['args'] ) && is_array( $raw['args'] ) ) {
			foreach ( $raw['args'] as $arg ) {
				$args[] = sanitize_text_field( (string) $arg );
			}
		}

		$requires_token = ! empty( $raw['requiresToken'] ) && false !== $raw['requiresToken'] && '0' !== $raw['requiresToken'];

		return array(
			'name'          => $name,
			'title'         => $title,
			'description'   => $description,
			'author'        => $author,
			'icon'          => $icon,
			'command'       => $command,
			'args'          => $args,
			'requiresToken' => (bool) $requires_token,
			'tokenHint'     => $token_hint,
		);
	}

	/**
	 * Persist sanitized fields onto a post's meta + title/content.
	 *
	 * @param int   $post_id Post ID.
	 * @param array $fields  Sanitized fields from sanitize_entry_input().
	 * @return void
	 */
	protected static function write_fields( $post_id, array $fields ) {
		update_post_meta( $post_id, AISG_MCP_Catalog_Meta::META_NAME, $fields['name'] );
		update_post_meta( $post_id, AISG_MCP_Catalog_Meta::META_AUTHOR, $fields['author'] );
		update_post_meta( $post_id, AISG_MCP_Catalog_Meta::META_ICON, $fields['icon'] );
		update_post_meta( $post_id, AISG_MCP_Catalog_Meta::META_COMMAND, $fields['command'] );
		// Args stored in the existing one-per-line format the public endpoint expects.
		update_post_meta( $post_id, AISG_MCP_Catalog_Meta::META_ARGS, implode( "\n", $fields['args'] ) );
		update_post_meta( $post_id, AISG_MCP_Catalog_Meta::META_REQUIRES_TOKEN, $fields['requiresToken'] ? '1' : '' );
		update_post_meta( $post_id, AISG_MCP_Catalog_Meta::META_TOKEN_HINT, $fields['tokenHint'] );
	}

	/**
	 * Create a PUBLISHED catalog post from sanitized fields.
	 *
	 * @param array $fields Sanitized fields.
	 * @return int|WP_Error New post ID, or WP_Error on failure.
	 */
	public static function create_entry( array $fields ) {
		$post_id = wp_insert_post(
			array(
				'post_type'    => AISG_MCP_CATALOG_CPT,
				'post_status'  => 'publish',
				'post_title'   => $fields['title'],
				'post_content' => $fields['description'],
			),
			true
		);
		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}
		// Fall back to the title for the slug name if none was provided.
		if ( '' === $fields['name'] && '' !== $fields['title'] ) {
			$fields['name'] = sanitize_title( $fields['title'] );
		}
		self::write_fields( $post_id, $fields );
		return (int) $post_id;
	}

	/**
	 * Update an existing catalog post from sanitized fields.
	 *
	 * @param int   $post_id Post ID (already validated as a catalog post).
	 * @param array $fields  Sanitized fields.
	 * @return int|WP_Error
	 */
	public static function update_entry( $post_id, array $fields ) {
		$result = wp_update_post(
			array(
				'ID'           => $post_id,
				'post_title'   => $fields['title'],
				'post_content' => $fields['description'],
			),
			true
		);
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		if ( '' === $fields['name'] && '' !== $fields['title'] ) {
			$fields['name'] = sanitize_title( $fields['title'] );
		}
		self::write_fields( $post_id, $fields );
		return (int) $post_id;
	}

	/**
	 * Permanently delete a catalog post.
	 *
	 * @param int $post_id Post ID (already validated as a catalog post).
	 * @return bool
	 */
	public static function delete_entry( $post_id ) {
		$deleted = wp_delete_post( $post_id, true );
		return false !== $deleted && null !== $deleted;
	}

	/* ---------------------------------------------------------------------
	 * Change log
	 * ------------------------------------------------------------------- */

	/**
	 * Append a change-log entry (newest first), capped at LOG_MAX.
	 *
	 * @param string $email      Actor email.
	 * @param string $action     create|update|delete|restore.
	 * @param string $entry_name Human-readable entry name/title.
	 * @param int    $entry_id   Post ID (0 when not applicable).
	 * @return void
	 */
	public static function log( $email, $action, $entry_name, $entry_id ) {
		$log = get_option( self::OPT_LOG, array() );
		if ( ! is_array( $log ) ) {
			$log = array();
		}
		array_unshift(
			$log,
			array(
				'time'       => gmdate( 'c' ),
				'email'      => (string) $email,
				'action'     => (string) $action,
				'entry_name' => (string) $entry_name,
				'entry_id'   => (int) $entry_id,
			)
		);
		if ( count( $log ) > self::LOG_MAX ) {
			$log = array_slice( $log, 0, self::LOG_MAX );
		}
		update_option( self::OPT_LOG, $log );
	}

	/**
	 * Get the change log (newest first).
	 *
	 * @return array[]
	 */
	public static function get_log() {
		$log = get_option( self::OPT_LOG, array() );
		return is_array( $log ) ? $log : array();
	}

	/* ---------------------------------------------------------------------
	 * Snapshots
	 * ------------------------------------------------------------------- */

	/**
	 * Save a full-catalog snapshot (newest first), keeping only SNAPSHOT_MAX.
	 *
	 * @param string $email  Actor email.
	 * @param string $action The action that triggered the snapshot.
	 * @return void
	 */
	public static function snapshot( $email, $action ) {
		$snapshots = self::get_snapshots();
		array_unshift(
			$snapshots,
			array(
				'time'    => gmdate( 'c' ),
				'email'   => (string) $email,
				'action'  => (string) $action,
				'entries' => self::get_all_entries(),
			)
		);
		if ( count( $snapshots ) > self::SNAPSHOT_MAX ) {
			$snapshots = array_slice( $snapshots, 0, self::SNAPSHOT_MAX );
		}
		update_option( self::OPT_SNAPSHOTS, $snapshots );
	}

	/**
	 * Get all stored snapshots (newest first).
	 *
	 * @return array[]
	 */
	public static function get_snapshots() {
		$snapshots = get_option( self::OPT_SNAPSHOTS, array() );
		return is_array( $snapshots ) ? $snapshots : array();
	}

	/**
	 * Record a successful mutation: append to the log AND save a fresh snapshot
	 * of the resulting catalog state.
	 *
	 * @param string $email      Actor email.
	 * @param string $action     create|update|delete|restore.
	 * @param string $entry_name Entry name/title.
	 * @param int    $entry_id   Post ID.
	 * @return void
	 */
	public static function record_change( $email, $action, $entry_name, $entry_id ) {
		self::log( $email, $action, $entry_name, $entry_id );
		self::snapshot( $email, $action );
	}

	/* ---------------------------------------------------------------------
	 * Rollback
	 * ------------------------------------------------------------------- */

	/**
	 * Restore the catalog to a snapshot by index. Deletes ALL current entries and
	 * recreates them from the snapshot. Captures a fresh snapshot of the
	 * pre-restore state first so the restore itself is reversible.
	 *
	 * @param int    $index Snapshot index (0 = newest).
	 * @param string $email Actor email (for logging).
	 * @return bool True on success, false when the index is invalid.
	 */
	public static function restore_snapshot( $index, $email ) {
		$index     = absint( $index );
		$snapshots = self::get_snapshots();
		if ( ! isset( $snapshots[ $index ] ) || ! is_array( $snapshots[ $index ]['entries'] ) ) {
			return false;
		}

		// 1. Snapshot the current (pre-restore) state so this is reversible.
		self::snapshot( $email, 'restore' );

		// Re-read the target AFTER snapshotting (indices shift by one as we just
		// unshifted a new snapshot to the front).
		$snapshots = self::get_snapshots();
		$target    = isset( $snapshots[ $index + 1 ] ) ? $snapshots[ $index + 1 ] : null;
		if ( null === $target || ! is_array( $target['entries'] ) ) {
			return false;
		}

		// 2. Delete every current catalog post.
		$current = self::get_all_entries();
		foreach ( $current as $entry ) {
			self::delete_entry( (int) $entry['id'] );
		}

		// 3. Recreate from the snapshot entries.
		foreach ( $target['entries'] as $entry ) {
			$fields = self::sanitize_entry_input( (array) $entry );
			self::create_entry( $fields );
		}

		// 4. Log the restore (no extra snapshot here; we already have the pre- and post-states).
		self::log( $email, 'restore', sprintf( 'snapshot @ %s', isset( $target['time'] ) ? $target['time'] : '' ), 0 );

		return true;
	}

	/* ---------------------------------------------------------------------
	 * Helpers
	 * ------------------------------------------------------------------- */

	/**
	 * Split a one-arg-per-line string into a clean array of strings (mirrors the
	 * public REST layer's behaviour).
	 *
	 * @param string $raw Raw multi-line args value.
	 * @return string[]
	 */
	protected static function split_args( $raw ) {
		if ( '' === trim( (string) $raw ) ) {
			return array();
		}
		$lines = preg_split( '/\r\n|\r|\n/', $raw );
		$args  = array();
		foreach ( $lines as $line ) {
			$line = rtrim( $line );
			if ( '' === trim( $line ) ) {
				continue;
			}
			$args[] = $line;
		}
		return $args;
	}
}

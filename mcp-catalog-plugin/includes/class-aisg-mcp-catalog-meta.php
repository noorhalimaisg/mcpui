<?php
/**
 * Meta box for MCP Catalog entries: fields, rendering, and save handling.
 *
 * @package AISG_MCP_Catalog
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class AISG_MCP_Catalog_Meta
 *
 * Renders and persists the per-entry meta fields used to build the catalog schema.
 */
class AISG_MCP_Catalog_Meta {

	/**
	 * Meta keys used by this plugin (single source of truth, also used by uninstall.php).
	 */
	const META_NAME           = '_aisg_mcp_name';
	const META_AUTHOR         = '_aisg_mcp_author';
	const META_ICON           = '_aisg_mcp_icon';
	const META_COMMAND        = '_aisg_mcp_command';
	const META_ARGS           = '_aisg_mcp_args';
	const META_REQUIRES_TOKEN = '_aisg_mcp_requires_token';
	const META_TOKEN_HINT     = '_aisg_mcp_token_hint';

	const NONCE_ACTION = 'aisg_mcp_catalog_save_meta';
	const NONCE_FIELD  = 'aisg_mcp_catalog_meta_nonce';

	/**
	 * Hook meta box registration, saving, and admin assets.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'add_meta_boxes', array( __CLASS__, 'add_meta_box' ) );
		add_action( 'save_post_' . AISG_MCP_CATALOG_CPT, array( __CLASS__, 'save' ), 10, 2 );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_assets' ) );
	}

	/**
	 * Register the meta box on the CPT edit screen.
	 *
	 * @return void
	 */
	public static function add_meta_box() {
		add_meta_box(
			'aisg_mcp_catalog_fields',
			__( 'MCP Server Details', 'mcp-catalog' ),
			array( __CLASS__, 'render' ),
			AISG_MCP_CATALOG_CPT,
			'normal',
			'high'
		);
	}

	/**
	 * Enqueue the media uploader and inline admin script/style on the CPT editor only.
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public static function enqueue_assets( $hook ) {
		if ( 'post.php' !== $hook && 'post-new.php' !== $hook ) {
			return;
		}
		$screen = get_current_screen();
		if ( ! $screen || AISG_MCP_CATALOG_CPT !== $screen->post_type ) {
			return;
		}

		// WordPress media uploader for the icon field.
		wp_enqueue_media();

		// Minimal inline script: media picker + auto-suggest slug from title.
		$js = <<<'JS'
( function() {
	document.addEventListener( 'DOMContentLoaded', function() {
		var frame;
		var btn      = document.getElementById( 'aisg-mcp-icon-select' );
		var clearBtn = document.getElementById( 'aisg-mcp-icon-clear' );
		var field    = document.getElementById( 'aisg-mcp-icon' );
		var preview  = document.getElementById( 'aisg-mcp-icon-preview' );

		function renderPreview() {
			if ( ! preview ) { return; }
			if ( field && field.value ) {
				preview.innerHTML = '';
				var img = document.createElement( 'img' );
				img.src = field.value;
				img.alt = '';
				img.style.maxWidth = '64px';
				img.style.maxHeight = '64px';
				img.style.borderRadius = '6px';
				preview.appendChild( img );
			} else {
				preview.textContent = '';
			}
		}

		if ( btn ) {
			btn.addEventListener( 'click', function( e ) {
				e.preventDefault();
				if ( frame ) { frame.open(); return; }
				frame = wp.media( {
					title: 'Select MCP Icon',
					button: { text: 'Use this icon' },
					library: { type: 'image' },
					multiple: false
				} );
				frame.on( 'select', function() {
					var att = frame.state().get( 'selection' ).first().toJSON();
					if ( field ) { field.value = att.url; }
					renderPreview();
				} );
				frame.open();
			} );
		}
		if ( clearBtn ) {
			clearBtn.addEventListener( 'click', function( e ) {
				e.preventDefault();
				if ( field ) { field.value = ''; }
				renderPreview();
			} );
		}
		if ( field ) {
			field.addEventListener( 'input', renderPreview );
		}

		// Auto-suggest the name/slug from the post title when the name field is empty.
		var nameField  = document.getElementById( 'aisg-mcp-name' );
		var titleField = document.getElementById( 'title' );
		if ( nameField && titleField ) {
			titleField.addEventListener( 'blur', function() {
				if ( ! nameField.value && titleField.value ) {
					nameField.value = titleField.value
						.toLowerCase()
						.replace( /[^a-z0-9]+/g, '-' )
						.replace( /^-+|-+$/g, '' );
				}
			} );
		}

		renderPreview();
	} );
} )();
JS;
		// Register a tiny no-op handle so we have something to attach inline JS to.
		wp_register_script( 'aisg-mcp-catalog-admin', '', array( 'jquery', 'media-editor' ), AISG_MCP_CATALOG_VERSION, true );
		wp_enqueue_script( 'aisg-mcp-catalog-admin' );
		wp_add_inline_script( 'aisg-mcp-catalog-admin', $js );

		// Scoped AISG-branded styling for the meta box.
		$css = '
			.aisg-mcp-field { margin: 0 0 18px; }
			.aisg-mcp-field > label { display:block; font-weight:600; color:#0B1F3A; margin-bottom:4px; }
			.aisg-mcp-field .description { color:#1A2A44; }
			.aisg-mcp-field input[type=text], .aisg-mcp-field textarea { width:100%; max-width:640px; }
			.aisg-mcp-icon-row { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
			.aisg-mcp-icon-preview { min-width:64px; min-height:24px; }
			#aisg-mcp-icon-select.button-primary { background:#E8352A !important; border-color:#c92b21 !important; color:#fff !important; box-shadow:none !important; text-shadow:none !important; }
		';
		wp_register_style( 'aisg-mcp-catalog-admin', false, array(), AISG_MCP_CATALOG_VERSION );
		wp_enqueue_style( 'aisg-mcp-catalog-admin' );
		wp_add_inline_style( 'aisg-mcp-catalog-admin', $css );
	}

	/**
	 * Render the meta box fields.
	 *
	 * @param WP_Post $post Current post object.
	 * @return void
	 */
	public static function render( $post ) {
		wp_nonce_field( self::NONCE_ACTION, self::NONCE_FIELD );

		$name           = get_post_meta( $post->ID, self::META_NAME, true );
		$author         = get_post_meta( $post->ID, self::META_AUTHOR, true );
		$icon           = get_post_meta( $post->ID, self::META_ICON, true );
		$command        = get_post_meta( $post->ID, self::META_COMMAND, true );
		$args           = get_post_meta( $post->ID, self::META_ARGS, true );
		$requires_token = (bool) get_post_meta( $post->ID, self::META_REQUIRES_TOKEN, true );
		$token_hint     = get_post_meta( $post->ID, self::META_TOKEN_HINT, true );

		if ( '' === $command ) {
			$command = 'npx';
		}
		?>
		<p class="description" style="margin-top:0;">
			<?php esc_html_e( 'These fields populate the public MCP Catalog endpoint consumed by the MCP Manager desktop app. The post title is used as the display title; the editor content above is used as the description.', 'mcp-catalog' ); ?>
		</p>

		<div class="aisg-mcp-field">
			<label for="aisg-mcp-name"><?php esc_html_e( 'Name / slug (server key)', 'mcp-catalog' ); ?></label>
			<input type="text" id="aisg-mcp-name" name="aisg_mcp_name" value="<?php echo esc_attr( $name ); ?>" placeholder="ai-singapore-shortener" />
			<p class="description"><?php esc_html_e( 'Lowercase, hyphenated. Used as the default server key. Must be unique. Leave blank to auto-suggest from the title.', 'mcp-catalog' ); ?></p>
		</div>

		<div class="aisg-mcp-field">
			<label for="aisg-mcp-author"><?php esc_html_e( 'Author', 'mcp-catalog' ); ?></label>
			<input type="text" id="aisg-mcp-author" name="aisg_mcp_author" value="<?php echo esc_attr( $author ); ?>" placeholder="Halim, Platform Engineering" />
		</div>

		<div class="aisg-mcp-field">
			<label for="aisg-mcp-icon"><?php esc_html_e( 'Icon URL', 'mcp-catalog' ); ?></label>
			<div class="aisg-mcp-icon-row">
				<input type="text" id="aisg-mcp-icon" name="aisg_mcp_icon" value="<?php echo esc_attr( $icon ); ?>" placeholder="https://example.org/wp-content/uploads/icon.png" />
				<button type="button" class="button button-primary" id="aisg-mcp-icon-select"><?php esc_html_e( 'Select / Upload', 'mcp-catalog' ); ?></button>
				<button type="button" class="button" id="aisg-mcp-icon-clear"><?php esc_html_e( 'Clear', 'mcp-catalog' ); ?></button>
				<span class="aisg-mcp-icon-preview" id="aisg-mcp-icon-preview"></span>
			</div>
			<p class="description"><?php esc_html_e( 'Pick from the media library or paste an absolute image URL. Leave empty for no icon.', 'mcp-catalog' ); ?></p>
		</div>

		<div class="aisg-mcp-field">
			<label for="aisg-mcp-command"><?php esc_html_e( 'Command', 'mcp-catalog' ); ?></label>
			<input type="text" id="aisg-mcp-command" name="aisg_mcp_command" value="<?php echo esc_attr( $command ); ?>" placeholder="npx" />
			<p class="description"><?php esc_html_e( 'Defaults to "npx" if left blank.', 'mcp-catalog' ); ?></p>
		</div>

		<div class="aisg-mcp-field">
			<label for="aisg-mcp-args"><?php esc_html_e( 'Args (one per line)', 'mcp-catalog' ); ?></label>
			<textarea id="aisg-mcp-args" name="aisg_mcp_args" rows="6" placeholder="mcp-remote&#10;https://aisg.sg/api/v1/mcp&#10;--header&#10;Authorization: Bearer {token}"><?php echo esc_textarea( $args ); ?></textarea>
			<p class="description"><?php esc_html_e( 'One argument per line. Use the literal placeholder {token} where the user token should be substituted by the desktop app. Do NOT paste a real token.', 'mcp-catalog' ); ?></p>
		</div>

		<div class="aisg-mcp-field">
			<label for="aisg-mcp-requires-token">
				<input type="checkbox" id="aisg-mcp-requires-token" name="aisg_mcp_requires_token" value="1" <?php checked( $requires_token ); ?> />
				<?php esc_html_e( 'Requires token', 'mcp-catalog' ); ?>
			</label>
		</div>

		<div class="aisg-mcp-field">
			<label for="aisg-mcp-token-hint"><?php esc_html_e( 'Token hint', 'mcp-catalog' ); ?></label>
			<input type="text" id="aisg-mcp-token-hint" name="aisg_mcp_token_hint" value="<?php echo esc_attr( $token_hint ); ?>" placeholder="Your aisg.sg API key" />
			<p class="description"><?php esc_html_e( 'Short hint shown to the user about which token to paste.', 'mcp-catalog' ); ?></p>
		</div>
		<?php
	}

	/**
	 * Persist the meta fields on save.
	 *
	 * @param int     $post_id Post ID.
	 * @param WP_Post $post    Post object.
	 * @return void
	 */
	public static function save( $post_id, $post ) {
		// Verify nonce.
		if ( ! isset( $_POST[ self::NONCE_FIELD ] ) ) {
			return;
		}
		$nonce = sanitize_text_field( wp_unslash( $_POST[ self::NONCE_FIELD ] ) );
		if ( ! wp_verify_nonce( $nonce, self::NONCE_ACTION ) ) {
			return;
		}

		// Skip autosave/revision.
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}
		if ( wp_is_post_revision( $post_id ) ) {
			return;
		}

		// Capability check.
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		// Name / slug: sanitize to a slug-like value.
		$name = isset( $_POST['aisg_mcp_name'] ) ? sanitize_text_field( wp_unslash( $_POST['aisg_mcp_name'] ) ) : '';
		$name = sanitize_title( $name );
		if ( '' === $name && ! empty( $post->post_title ) ) {
			$name = sanitize_title( $post->post_title );
		}
		update_post_meta( $post_id, self::META_NAME, $name );

		// Author.
		$author = isset( $_POST['aisg_mcp_author'] ) ? sanitize_text_field( wp_unslash( $_POST['aisg_mcp_author'] ) ) : '';
		update_post_meta( $post_id, self::META_AUTHOR, $author );

		// Icon URL.
		$icon = isset( $_POST['aisg_mcp_icon'] ) ? esc_url_raw( wp_unslash( $_POST['aisg_mcp_icon'] ) ) : '';
		update_post_meta( $post_id, self::META_ICON, $icon );

		// Command (default npx).
		$command = isset( $_POST['aisg_mcp_command'] ) ? sanitize_text_field( wp_unslash( $_POST['aisg_mcp_command'] ) ) : '';
		if ( '' === $command ) {
			$command = 'npx';
		}
		update_post_meta( $post_id, self::META_COMMAND, $command );

		// Args: keep as a sanitized multi-line string; the REST layer splits into an array.
		$args = isset( $_POST['aisg_mcp_args'] ) ? sanitize_textarea_field( wp_unslash( $_POST['aisg_mcp_args'] ) ) : '';
		update_post_meta( $post_id, self::META_ARGS, $args );

		// Requires token (checkbox -> bool stored as '1'/'').
		$requires_token = ! empty( $_POST['aisg_mcp_requires_token'] ) ? '1' : '';
		update_post_meta( $post_id, self::META_REQUIRES_TOKEN, $requires_token );

		// Token hint.
		$token_hint = isset( $_POST['aisg_mcp_token_hint'] ) ? sanitize_text_field( wp_unslash( $_POST['aisg_mcp_token_hint'] ) ) : '';
		update_post_meta( $post_id, self::META_TOKEN_HINT, $token_hint );
	}
}

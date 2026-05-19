<?php
if (!defined('ABSPATH')) {
    exit;
}

class Omnivera_WI_Admin {
    private $client;
    private $logger;
    private $sync;

    public function __construct($client, $logger, $sync) {
        $this->client = $client;
        $this->logger = $logger;
        $this->sync = $sync;
    }

    public function init() {
        add_action('admin_menu', array($this, 'menu'));
        add_action('admin_post_omnivera_wi_save', array($this, 'save'));
        add_action('admin_post_omnivera_wi_connect', array($this, 'connect'));
        add_action('admin_post_omnivera_wi_disconnect', array($this, 'disconnect'));
        add_action('admin_post_omnivera_wi_sync', array($this, 'sync_now'));
    }

    public function menu() {
        add_options_page(
            __('Omnivera Website Intelligence', 'omnivera-website-intelligence'),
            __('Omnivera', 'omnivera-website-intelligence'),
            'manage_options',
            'omnivera-website-intelligence',
            array($this, 'render')
        );
    }

    public function render() {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('You do not have permission to manage Omnivera.', 'omnivera-website-intelligence'));
        }
        $options = get_option('omnivera_wi_options', array());
        $connected = $this->client->is_connected();
        $diagnostics = $this->sync->diagnostics();
        ?>
        <div class="wrap">
            <h1><?php echo esc_html__('Omnivera Website Intelligence', 'omnivera-website-intelligence'); ?></h1>
            <h2><?php echo esc_html__('Connection Status', 'omnivera-website-intelligence'); ?></h2>
            <p><?php echo $connected ? esc_html__('Connected', 'omnivera-website-intelligence') : esc_html__('Not connected', 'omnivera-website-intelligence'); ?></p>
            <?php if (!$connected) : ?>
                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                    <?php wp_nonce_field('omnivera_wi_connect'); ?>
                    <input type="hidden" name="action" value="omnivera_wi_connect" />
                    <table class="form-table" role="presentation">
                        <tr>
                            <th scope="row"><label for="setup_token"><?php echo esc_html__('Setup token', 'omnivera-website-intelligence'); ?></label></th>
                            <td><input class="regular-text" id="setup_token" name="setup_token" type="text" autocomplete="off" /></td>
                        </tr>
                    </table>
                    <?php submit_button(__('Connect Omnivera', 'omnivera-website-intelligence')); ?>
                </form>
            <?php else : ?>
                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:inline-block">
                    <?php wp_nonce_field('omnivera_wi_sync'); ?>
                    <input type="hidden" name="action" value="omnivera_wi_sync" />
                    <?php submit_button(__('Run Sync Now', 'omnivera-website-intelligence'), 'secondary', 'submit', false); ?>
                </form>
                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:inline-block;margin-left:8px">
                    <?php wp_nonce_field('omnivera_wi_disconnect'); ?>
                    <input type="hidden" name="action" value="omnivera_wi_disconnect" />
                    <?php submit_button(__('Disconnect', 'omnivera-website-intelligence'), 'delete', 'submit', false); ?>
                </form>
            <?php endif; ?>

            <h2><?php echo esc_html__('Website Status', 'omnivera-website-intelligence'); ?></h2>
            <p><?php echo esc_html(home_url()); ?></p>
            <p><?php echo esc_html__('Website ID:', 'omnivera-website-intelligence') . ' ' . esc_html(get_option('omnivera_wi_website_id', '')); ?></p>

            <h2><?php echo esc_html__('Tracking Status', 'omnivera-website-intelligence'); ?></h2>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <?php wp_nonce_field('omnivera_wi_save'); ?>
                <input type="hidden" name="action" value="omnivera_wi_save" />
                <table class="form-table" role="presentation">
                    <tr><th scope="row"><?php echo esc_html__('API base', 'omnivera-website-intelligence'); ?></th><td><input class="regular-text" name="api_base" value="<?php echo esc_attr($options['api_base'] ?? 'https://www.omnivyra.com'); ?>" /></td></tr>
                    <tr><th scope="row"><?php echo esc_html__('Enable tracking', 'omnivera-website-intelligence'); ?></th><td><input type="checkbox" name="tracking_enabled" value="1" <?php checked(!empty($options['tracking_enabled'])); ?> /></td></tr>
                    <tr><th scope="row"><?php echo esc_html__('Manual tracker override', 'omnivera-website-intelligence'); ?></th><td><input type="checkbox" name="manual_tracker_override" value="1" <?php checked(!empty($options['manual_tracker_override'])); ?> /></td></tr>
                    <tr><th scope="row"><?php echo esc_html__('Exclude admins', 'omnivera-website-intelligence'); ?></th><td><input type="checkbox" name="exclude_admins" value="1" <?php checked(!empty($options['exclude_admins'])); ?> /></td></tr>
                    <tr><th scope="row"><?php echo esc_html__('Consent mode', 'omnivera-website-intelligence'); ?></th><td><input name="consent_mode" value="<?php echo esc_attr($options['consent_mode'] ?? 'unknown'); ?>" /></td></tr>
                    <tr><th scope="row"><?php echo esc_html__('Excluded paths', 'omnivera-website-intelligence'); ?></th><td><textarea name="excluded_paths" rows="4" cols="60"><?php echo esc_textarea($options['excluded_paths'] ?? ''); ?></textarea></td></tr>
                    <tr><th scope="row"><?php echo esc_html__('Debug mode', 'omnivera-website-intelligence'); ?></th><td><input type="checkbox" name="debug_enabled" value="1" <?php checked(!empty($options['debug_enabled'])); ?> /></td></tr>
                </table>
                <?php submit_button(__('Save Settings', 'omnivera-website-intelligence')); ?>
            </form>

            <h2><?php echo esc_html__('Publishing Status', 'omnivera-website-intelligence'); ?></h2>
            <p><?php echo esc_html__('Post, taxonomy, author, media, permalink, and deletion events are synced to Omnivera when connected.', 'omnivera-website-intelligence'); ?></p>

            <h2><?php echo esc_html__('Diagnostics', 'omnivera-website-intelligence'); ?></h2>
            <table class="widefat striped"><tbody>
                <?php foreach ($diagnostics as $key => $value) : ?>
                    <tr><th><?php echo esc_html($key); ?></th><td><?php echo esc_html(is_scalar($value) ? (string) $value : wp_json_encode($value)); ?></td></tr>
                <?php endforeach; ?>
            </tbody></table>

            <h2><?php echo esc_html__('Debug Logs', 'omnivera-website-intelligence'); ?></h2>
            <table class="widefat striped"><tbody>
                <?php foreach (array_reverse($this->logger->logs()) as $log) : ?>
                    <tr><td><?php echo esc_html($log['time']); ?></td><td><?php echo esc_html($log['level']); ?></td><td><?php echo esc_html($log['message']); ?></td></tr>
                <?php endforeach; ?>
            </tbody></table>
        </div>
        <?php
    }

    public function save() {
        $this->guard('omnivera_wi_save');
        update_option('omnivera_wi_options', array(
            'api_base' => esc_url_raw(wp_unslash($_POST['api_base'] ?? 'https://www.omnivyra.com')),
            'tracking_enabled' => !empty($_POST['tracking_enabled']),
            'manual_tracker_override' => !empty($_POST['manual_tracker_override']),
            'exclude_admins' => !empty($_POST['exclude_admins']),
            'debug_enabled' => !empty($_POST['debug_enabled']),
            'consent_mode' => sanitize_key(wp_unslash($_POST['consent_mode'] ?? 'unknown')),
            'excluded_paths' => sanitize_textarea_field(wp_unslash($_POST['excluded_paths'] ?? '')),
        ), false);
        wp_safe_redirect(admin_url('options-general.php?page=omnivera-website-intelligence&updated=1'));
        exit;
    }

    public function connect() {
        $this->guard('omnivera_wi_connect');
        $token = sanitize_text_field(wp_unslash($_POST['setup_token'] ?? ''));
        $result = $this->client->connect_with_setup_token($token);
        $arg = is_wp_error($result) ? 'omnivera_error=' . rawurlencode($result->get_error_message()) : 'connected=1';
        wp_safe_redirect(admin_url('options-general.php?page=omnivera-website-intelligence&' . $arg));
        exit;
    }

    public function disconnect() {
        $this->guard('omnivera_wi_disconnect');
        $this->client->disconnect();
        wp_safe_redirect(admin_url('options-general.php?page=omnivera-website-intelligence&disconnected=1'));
        exit;
    }

    public function sync_now() {
        $this->guard('omnivera_wi_sync');
        $this->sync->sync_all();
        wp_safe_redirect(admin_url('options-general.php?page=omnivera-website-intelligence&synced=1'));
        exit;
    }

    private function guard($action) {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('You do not have permission to manage Omnivera.', 'omnivera-website-intelligence'));
        }
        check_admin_referer($action);
    }
}

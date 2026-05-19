<?php
/**
 * Plugin Name: Omnivera Website Intelligence
 * Description: Connects WordPress to Omnivera for tracking, publishing sync, diagnostics, and website intelligence.
 * Version: 0.4.0
 * Author: Omnivera
 * Requires at least: 6.0
 * Requires PHP: 8.1
 * Network: true
 * Text Domain: omnivera-website-intelligence
 */

if (!defined('ABSPATH')) {
    exit;
}

define('OMNIVERA_WI_VERSION', '0.4.0');
define('OMNIVERA_WI_FILE', __FILE__);
define('OMNIVERA_WI_DIR', plugin_dir_path(__FILE__));
define('OMNIVERA_WI_URL', plugin_dir_url(__FILE__));

require_once OMNIVERA_WI_DIR . 'includes/class-omnivera-client.php';
require_once OMNIVERA_WI_DIR . 'includes/class-omnivera-logger.php';
require_once OMNIVERA_WI_DIR . 'includes/class-omnivera-tracker.php';
require_once OMNIVERA_WI_DIR . 'includes/class-omnivera-sync.php';
require_once OMNIVERA_WI_DIR . 'includes/class-omnivera-admin.php';
require_once OMNIVERA_WI_DIR . 'includes/class-omnivera-plugin.php';

register_activation_hook(__FILE__, array('Omnivera_WI_Plugin', 'activate'));
register_deactivation_hook(__FILE__, array('Omnivera_WI_Plugin', 'deactivate'));

add_action('plugins_loaded', function () {
    Omnivera_WI_Plugin::instance()->init();
});

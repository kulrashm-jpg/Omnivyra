<?php
if (!defined('ABSPATH')) {
    exit;
}

class Omnivera_WI_Plugin {
    private static $instance = null;
    private $client;
    private $logger;
    private $tracker;
    private $sync;
    private $admin;

    public static function instance() {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        $this->logger = new Omnivera_WI_Logger();
        $this->client = new Omnivera_WI_Client($this->logger);
        $this->tracker = new Omnivera_WI_Tracker($this->client, $this->logger);
        $this->sync = new Omnivera_WI_Sync($this->client, $this->logger);
        $this->admin = new Omnivera_WI_Admin($this->client, $this->logger, $this->sync);
    }

    public function init() {
        $this->maybe_migrate();
        $this->admin->init();
        $this->tracker->init();
        $this->sync->init();
        add_action('omnivera_wi_heartbeat', array($this, 'heartbeat'));
        add_action('omnivera_wi_sync_metadata', array($this->sync, 'sync_all'));
        if (!wp_next_scheduled('omnivera_wi_heartbeat')) {
            wp_schedule_event(time() + 60, 'hourly', 'omnivera_wi_heartbeat');
        }
        if (!wp_next_scheduled('omnivera_wi_sync_metadata')) {
            wp_schedule_event(time() + 120, 'twicedaily', 'omnivera_wi_sync_metadata');
        }
    }

    public static function activate() {
        add_option('omnivera_wi_options', array(
            'api_base' => 'https://www.omnivyra.com',
            'tracking_enabled' => true,
            'debug_enabled' => false,
            'exclude_admins' => true,
            'manual_tracker_override' => false,
            'consent_mode' => 'unknown',
            'excluded_paths' => '',
        ));
        if (!wp_next_scheduled('omnivera_wi_heartbeat')) {
            wp_schedule_event(time() + 60, 'hourly', 'omnivera_wi_heartbeat');
        }
    }

    public static function deactivate() {
        wp_clear_scheduled_hook('omnivera_wi_heartbeat');
        wp_clear_scheduled_hook('omnivera_wi_sync_metadata');
    }

    public function heartbeat() {
        $this->client->heartbeat($this->sync->diagnostics());
    }

    private function maybe_migrate() {
        $stored = get_option('omnivera_wi_version');
        if ($stored === OMNIVERA_WI_VERSION) {
            return;
        }
        update_option('omnivera_wi_version', OMNIVERA_WI_VERSION, false);
    }
}

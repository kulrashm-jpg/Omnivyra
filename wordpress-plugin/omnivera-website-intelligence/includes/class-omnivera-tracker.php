<?php
if (!defined('ABSPATH')) {
    exit;
}

class Omnivera_WI_Tracker {
    private $client;
    private $logger;

    public function __construct($client, $logger) {
        $this->client = $client;
        $this->logger = $logger;
    }

    public function init() {
        add_action('wp_head', array($this, 'inject_tracker'), 20);
    }

    public function inject_tracker() {
        if (!$this->should_inject()) {
            return;
        }
        $website_id = $this->client->website_id();
        if (empty($website_id)) {
            return;
        }
        $options = get_option('omnivera_wi_options', array());
        $api_base = !empty($options['api_base']) ? esc_url($options['api_base']) : '';
        $endpoint = $api_base ? rtrim($api_base, '/') . '/api/website-events/track' : '/api/website-events/track';
        echo "\n" . '<script id="omnivera-tracker" src="' . esc_url($api_base ? rtrim($api_base, '/') . '/omnivera-tracker.js' : '/omnivera-tracker.js') . '" data-website-id="' . esc_attr($website_id) . '" data-endpoint="' . esc_url($endpoint) . '" async></script>' . "\n";
        echo '<script>window.OmniveraConsentState=window.OmniveraConsentState||"' . esc_js($options['consent_mode'] ?? 'unknown') . '";</script>' . "\n";
    }

    public function diagnostics() {
        return array(
            'tracking_enabled' => $this->should_inject(),
            'website_id_present' => !empty($this->client->website_id()),
            'duplicate_guard' => true,
            'manual_override' => !empty(get_option('omnivera_wi_options', array())['manual_tracker_override']),
        );
    }

    private function should_inject() {
        $options = get_option('omnivera_wi_options', array());
        if (empty($options['tracking_enabled'])) {
            return false;
        }
        if (!empty($options['manual_tracker_override'])) {
            return false;
        }
        if (!empty($options['exclude_admins']) && is_user_logged_in() && current_user_can('manage_options')) {
            return false;
        }
        $excluded = sanitize_text_field($options['excluded_paths'] ?? '');
        if ($excluded) {
            $path = wp_parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
            foreach (array_filter(array_map('trim', explode("\n", $excluded))) as $rule) {
                if ($rule && false !== strpos($path, $rule)) {
                    return false;
                }
            }
        }
        return $this->client->is_connected();
    }
}

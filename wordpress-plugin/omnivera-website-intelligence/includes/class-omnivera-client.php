<?php
if (!defined('ABSPATH')) {
    exit;
}

class Omnivera_WI_Client {
    private $logger;

    public function __construct($logger) {
        $this->logger = $logger;
    }

    public function connect_with_setup_token($setup_token) {
        $setup_token = sanitize_text_field($setup_token);
        if (empty($setup_token)) {
            return new WP_Error('missing_setup_token', __('Setup token is required.', 'omnivera-website-intelligence'));
        }
        $payload = array(
            'setup_token' => $setup_token,
            'site_url' => home_url(),
            'admin_url' => admin_url(),
            'plugin_site_id' => $this->plugin_site_id(),
            'plugin_version' => OMNIVERA_WI_VERSION,
            'wp_version' => get_bloginfo('version'),
            'php_version' => PHP_VERSION,
            'multisite' => is_multisite(),
            'capabilities' => $this->capabilities(),
            'settings' => $this->public_settings(),
        );
        $response = $this->request('/api/wordpress-plugin/setup/connect', $payload, false);
        if (is_wp_error($response)) {
            return $response;
        }
        if (empty($response['accessToken']) || empty($response['registrationId']) || empty($response['websiteId'])) {
            return new WP_Error('invalid_connect_response', __('Omnivera did not return connection credentials.', 'omnivera-website-intelligence'));
        }
        update_option('omnivera_wi_registration_id', sanitize_text_field($response['registrationId']), false);
        update_option('omnivera_wi_access_token', sanitize_text_field($response['accessToken']), false);
        update_option('omnivera_wi_website_id', sanitize_text_field($response['websiteId']), false);
        update_option('omnivera_wi_connection_id', sanitize_text_field($response['connectionId'] ?? ''), false);
        $this->logger->log('info', 'Connected to Omnivera.', array('website_id' => $response['websiteId']));
        return $response;
    }

    public function disconnect() {
        $registration_id = get_option('omnivera_wi_registration_id');
        if ($registration_id) {
            $this->request('/api/wordpress-plugin/revoke', array(
                'registration_id' => $registration_id,
                'reason' => 'Disconnected from WordPress plugin',
            ), true);
        }
        delete_option('omnivera_wi_access_token');
        delete_option('omnivera_wi_registration_id');
        delete_option('omnivera_wi_website_id');
        delete_option('omnivera_wi_connection_id');
        $this->logger->log('warning', 'Disconnected from Omnivera.');
    }

    public function heartbeat($diagnostics) {
        if (!$this->is_connected()) {
            return false;
        }
        return $this->request('/api/wordpress-plugin/heartbeat', array(
            'plugin_version' => OMNIVERA_WI_VERSION,
            'wp_version' => get_bloginfo('version'),
            'php_version' => PHP_VERSION,
            'health_status' => $diagnostics['overall_status'] ?? 'healthy',
            'metadata' => $diagnostics,
            'settings' => $this->public_settings(),
            'capabilities' => $this->capabilities(),
        ), true);
    }

    public function sync_event($event_type, $payload) {
        if (!$this->is_connected()) {
            return false;
        }
        return $this->request('/api/wordpress-plugin/sync', array(
            'event_type' => sanitize_key($event_type),
            'idempotency_key' => sanitize_key($event_type) . '-' . md5(wp_json_encode($payload)),
            'payload' => $payload,
        ), true);
    }

    public function rotate_token() {
        if (!$this->is_connected()) {
            return false;
        }
        $response = $this->request('/api/wordpress-plugin/token-rotate', array(
            'registration_id' => get_option('omnivera_wi_registration_id'),
        ), true);
        if (!is_wp_error($response) && !empty($response['accessToken'])) {
            update_option('omnivera_wi_access_token', sanitize_text_field($response['accessToken']), false);
        }
        return $response;
    }

    public function request($path, $payload, $auth) {
        $options = get_option('omnivera_wi_options', array());
        $base = !empty($options['api_base']) ? esc_url_raw($options['api_base']) : 'https://www.omnivyra.com';
        $headers = array(
            'Content-Type' => 'application/json',
            'X-Omnivera-Plugin-Version' => OMNIVERA_WI_VERSION,
            'X-Omnivera-Nonce' => wp_generate_uuid4(),
            'X-Omnivera-Timestamp' => (string) time(),
        );
        if ($auth) {
            $token = get_option('omnivera_wi_access_token');
            if (!$token) {
                return new WP_Error('missing_token', __('Plugin is not connected.', 'omnivera-website-intelligence'));
            }
            $headers['Authorization'] = 'Bearer ' . $token;
        }
        $response = wp_remote_post(rtrim($base, '/') . $path, array(
            'timeout' => 20,
            'headers' => $headers,
            'body' => wp_json_encode($payload),
        ));
        if (is_wp_error($response)) {
            $this->logger->log('error', 'Omnivera request failed.', array('path' => $path, 'error' => $response->get_error_message()));
            return $response;
        }
        $code = wp_remote_retrieve_response_code($response);
        $body = json_decode(wp_remote_retrieve_body($response), true);
        if ($code < 200 || $code >= 300) {
            $message = is_array($body) && !empty($body['error']) ? $body['error'] : 'Omnivera request failed.';
            $this->logger->log('error', $message, array('path' => $path, 'status' => $code));
            return new WP_Error('omnivera_api_error', $message, array('status' => $code));
        }
        return is_array($body) ? $body : array();
    }

    public function is_connected() {
        return (bool) get_option('omnivera_wi_access_token');
    }

    public function website_id() {
        return sanitize_text_field(get_option('omnivera_wi_website_id', ''));
    }

    public function plugin_site_id() {
        $site_id = get_option('omnivera_wi_plugin_site_id');
        if (!$site_id) {
            $site_id = wp_generate_uuid4();
            update_option('omnivera_wi_plugin_site_id', $site_id, false);
        }
        return $site_id;
    }

    private function public_settings() {
        $options = get_option('omnivera_wi_options', array());
        return array(
            'tracking_enabled' => !empty($options['tracking_enabled']),
            'manual_tracker_override' => !empty($options['manual_tracker_override']),
            'exclude_admins' => !empty($options['exclude_admins']),
            'consent_mode' => sanitize_key($options['consent_mode'] ?? 'unknown'),
            'excluded_paths' => sanitize_text_field($options['excluded_paths'] ?? ''),
        );
    }

    private function capabilities() {
        return array(
            'tracking_injection' => true,
            'taxonomy_sync' => true,
            'media_sync' => true,
            'post_sync' => true,
            'diagnostics' => true,
            'token_rotation' => true,
            'multisite' => is_multisite(),
        );
    }
}

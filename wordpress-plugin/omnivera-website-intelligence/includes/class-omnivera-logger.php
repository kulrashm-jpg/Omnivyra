<?php
if (!defined('ABSPATH')) {
    exit;
}

class Omnivera_WI_Logger {
    public function log($level, $message, $context = array()) {
        $options = get_option('omnivera_wi_options', array());
        $entry = array(
            'time' => gmdate('c'),
            'level' => sanitize_key($level),
            'message' => sanitize_text_field($message),
            'context' => $this->sanitize_context($context),
        );
        $logs = get_option('omnivera_wi_debug_logs', array());
        $logs[] = $entry;
        $logs = array_slice($logs, -100);
        update_option('omnivera_wi_debug_logs', $logs, false);
        if (!empty($options['debug_enabled'])) {
            error_log('[Omnivera] ' . $entry['level'] . ': ' . $entry['message']);
        }
    }

    public function logs() {
        $logs = get_option('omnivera_wi_debug_logs', array());
        return is_array($logs) ? $logs : array();
    }

    private function sanitize_context($context) {
        if (!is_array($context)) {
            return array();
        }
        $clean = array();
        foreach ($context as $key => $value) {
            $clean[sanitize_key($key)] = is_scalar($value) ? sanitize_text_field((string) $value) : wp_json_encode($value);
        }
        return $clean;
    }
}

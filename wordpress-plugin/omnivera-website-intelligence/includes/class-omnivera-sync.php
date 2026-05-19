<?php
if (!defined('ABSPATH')) {
    exit;
}

class Omnivera_WI_Sync {
    private $client;
    private $logger;

    public function __construct($client, $logger) {
        $this->client = $client;
        $this->logger = $logger;
    }

    public function init() {
        add_action('save_post', array($this, 'sync_post'), 20, 3);
        add_action('before_delete_post', array($this, 'sync_deleted_post'), 20, 1);
        add_action('created_category', array($this, 'sync_taxonomy'));
        add_action('edited_category', array($this, 'sync_taxonomy'));
        add_action('created_post_tag', array($this, 'sync_taxonomy'));
        add_action('edited_post_tag', array($this, 'sync_taxonomy'));
        add_action('add_attachment', array($this, 'sync_media'));
        add_action('edit_attachment', array($this, 'sync_media'));
    }

    public function sync_all() {
        if (!$this->client->is_connected()) {
            return false;
        }
        $this->sync_taxonomy();
        $this->sync_authors();
        $this->sync_recent_posts();
        return $this->client->heartbeat($this->diagnostics());
    }

    public function sync_taxonomy() {
        $items = array();
        foreach (array('category', 'post_tag') as $taxonomy) {
            $terms = get_terms(array('taxonomy' => $taxonomy, 'hide_empty' => false, 'number' => 200));
            if (is_wp_error($terms)) {
                continue;
            }
            foreach ($terms as $term) {
                $items[] = array(
                    'id' => (string) $term->term_id,
                    'name' => $term->name,
                    'slug' => $term->slug,
                    'taxonomy_type' => 'post_tag' === $taxonomy ? 'tag' : 'category',
                    'count' => (int) $term->count,
                );
            }
        }
        return $this->client->sync_event('taxonomy.sync', array('items' => $items, 'cursor' => gmdate('c')));
    }

    public function sync_media($attachment_id = null) {
        $ids = $attachment_id ? array(absint($attachment_id)) : get_posts(array(
            'post_type' => 'attachment',
            'post_status' => 'inherit',
            'numberposts' => 100,
            'fields' => 'ids',
        ));
        $items = array();
        foreach ($ids as $id) {
            $items[] = array(
                'id' => (string) $id,
                'url' => wp_get_attachment_url($id),
                'media_type' => get_post_mime_type($id),
                'title' => get_the_title($id),
                'modified_at' => get_post_modified_time('c', true, $id),
            );
        }
        return $this->client->sync_event('media.sync', array('items' => $items, 'cursor' => gmdate('c')));
    }

    public function sync_post($post_id, $post = null, $update = null) {
        if (wp_is_post_revision($post_id) || 'post' !== get_post_type($post_id)) {
            return false;
        }
        $payload = $this->post_payload($post_id, false);
        return $this->client->sync_event('post.sync', array('items' => array($payload), 'cursor' => gmdate('c')));
    }

    public function sync_deleted_post($post_id) {
        if ('post' !== get_post_type($post_id)) {
            return false;
        }
        return $this->client->sync_event('post.deleted', array(
            'items' => array(array('id' => (string) $post_id, 'deleted_at' => gmdate('c'))),
            'cursor' => gmdate('c'),
        ));
    }

    public function sync_recent_posts() {
        $ids = get_posts(array(
            'post_type' => 'post',
            'post_status' => array('publish', 'draft', 'future', 'pending', 'private'),
            'numberposts' => 100,
            'orderby' => 'modified',
            'order' => 'DESC',
            'fields' => 'ids',
        ));
        $items = array();
        foreach ($ids as $id) {
            $items[] = $this->post_payload($id, false);
        }
        return $this->client->sync_event('post.sync', array('items' => $items, 'cursor' => gmdate('c')));
    }

    public function sync_authors() {
        $users = get_users(array('number' => 100, 'fields' => array('ID', 'display_name', 'user_nicename')));
        $items = array();
        foreach ($users as $user) {
            $items[] = array('id' => (string) $user->ID, 'name' => $user->display_name, 'slug' => $user->user_nicename, 'taxonomy_type' => 'author');
        }
        return $this->client->sync_event('taxonomy.sync', array('items' => $items, 'cursor' => gmdate('c')));
    }

    public function diagnostics() {
        return array(
            'overall_status' => $this->client->is_connected() ? 'healthy' : 'warning',
            'rest_api_access' => rest_url() ? 'healthy' : 'failed',
            'tracking_delivery' => get_option('omnivera_wi_website_id') ? 'healthy' : 'warning',
            'taxonomy_sync' => 'ready',
            'media_sync' => 'ready',
            'post_sync' => 'ready',
            'plugin_version' => OMNIVERA_WI_VERSION,
            'wp_version' => get_bloginfo('version'),
            'php_version' => PHP_VERSION,
        );
    }

    private function post_payload($post_id, $deleted) {
        return array(
            'id' => (string) $post_id,
            'title' => get_the_title($post_id),
            'slug' => get_post_field('post_name', $post_id),
            'permalink' => get_permalink($post_id),
            'status' => get_post_status($post_id),
            'author_external_id' => (string) get_post_field('post_author', $post_id),
            'modified_at' => get_post_modified_time('c', true, $post_id),
            'deleted_at' => $deleted ? gmdate('c') : null,
        );
    }
}

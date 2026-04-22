import type { RpaScript, RpaStep } from './rpaPlaywrightRunner';
import type { ResolverCandidate } from './selectorResolver';
import type { RpaTask } from './rpaWorkerService';

/**
 * Per-platform RPA scripts. Selectors are declared as ordered candidate
 * lists; the runner's resolver tries each in priority order with retry
 * + text-heuristic fallback. Platforms rotate their DOM frequently so
 * every step's primary selector is backed by one or two alternates.
 *
 * MVP: reply + like. Returns a structured { error } when a platform /
 * action combination has no script.
 */

export type ScriptBuilder = (task: RpaTask) => RpaScript | { error: string };

// Short-hands for common candidate lists.
const composerContentEditable: ResolverCandidate[] = [
  'div[role="textbox"][contenteditable="true"]',
  { kind: 'css', value: '.ql-editor' },
  { kind: 'role', role: 'textbox' },
];

const composerTextarea: ResolverCandidate[] = [
  'textarea',
  { kind: 'role', role: 'textbox' },
];

const replyScripts: Record<string, ScriptBuilder> = {
  linkedin: (task) => {
    if (!task.text) return { error: 'TEXT_REQUIRED' };
    const steps: RpaStep[] = [
      {
        kind: 'wait_for_any',
        selectors: [
          'button[aria-label*="comment" i]',
          '.comments-comment-box',
          '[data-test-id="comment-entry"]',
          { kind: 'i18n', semanticKey: 'comment', role: 'button' },
        ],
        timeout: 15_000,
        textHeuristics: ['Comment', 'Add a comment'],
      },
      {
        kind: 'click',
        selectors: [
          'button[aria-label*="comment" i]:not([aria-disabled="true"])',
          { kind: 'i18n', semanticKey: 'comment', role: 'button' },
        ],
        timeout: 6_000,
      },
      {
        kind: 'wait_for_any',
        selectors: [
          '.ql-editor',
          '[contenteditable="true"][role="textbox"]',
        ],
        timeout: 10_000,
      },
      {
        kind: 'type_contenteditable',
        selectors: [
          '.ql-editor',
          '[contenteditable="true"][role="textbox"]',
        ],
        text: task.text,
      },
      {
        kind: 'click',
        selectors: [
          'button.comments-comment-box__submit-button',
          'button[type="submit"]',
          { kind: 'role', role: 'button', name: /post|submit/i },
        ],
        timeout: 10_000,
      },
    ];
    return {
      targetUrl: task.target_url,
      steps,
      postCondition: {
        kind: 'selector_visible',
        selectors: [
          '.comments-comment-item',
          '.comments-comment-list',
          'article .ql-editor:empty',
        ],
        timeout: 8_000,
      },
    };
  },

  facebook: (task) => {
    if (!task.text) return { error: 'TEXT_REQUIRED' };
    return {
      targetUrl: task.target_url,
      steps: [
        {
          kind: 'wait_for_any',
          selectors: [
            'div[role="textbox"][contenteditable="true"]',
            'textarea[placeholder*="Write a comment" i]',
          ],
          timeout: 15_000,
          textHeuristics: ['Write a comment'],
        },
        {
          kind: 'type_contenteditable',
          selectors: [
            'div[role="textbox"][contenteditable="true"]',
            'textarea',
          ],
          text: task.text,
        },
        {
          kind: 'press',
          selectors: ['div[role="textbox"][contenteditable="true"]', 'textarea'],
          key: 'Enter',
        },
      ],
      postCondition: {
        kind: 'selector_visible',
        selectors: ['[role="article"]'],
        timeout: 6_000,
      },
    };
  },

  instagram: (task) => {
    if (!task.text) return { error: 'TEXT_REQUIRED' };
    return {
      targetUrl: task.target_url,
      steps: [
        {
          kind: 'wait_for_any',
          selectors: [
            'textarea[placeholder*="Add a comment" i]',
            'textarea[aria-label*="comment" i]',
            { kind: 'role', role: 'textbox', name: /comment/i },
          ],
          timeout: 15_000,
        },
        {
          kind: 'fill',
          selectors: [
            'textarea[placeholder*="Add a comment" i]',
            'textarea[aria-label*="comment" i]',
            'textarea',
          ],
          text: task.text,
        },
        {
          kind: 'click',
          selectors: [
            'button[type="submit"]',
            { kind: 'role', role: 'button', name: /post/i },
          ],
          timeout: 10_000,
        },
      ],
      postCondition: {
        kind: 'selector_visible',
        selectors: ['ul li:last-child'],
        timeout: 6_000,
      },
    };
  },

  twitter: (task) => {
    if (!task.text) return { error: 'TEXT_REQUIRED' };
    return {
      targetUrl: task.target_url,
      steps: [
        {
          kind: 'wait_for_any',
          selectors: [
            'div[data-testid="tweetTextarea_0"]',
            'div[role="textbox"][contenteditable="true"]',
          ],
          timeout: 15_000,
        },
        {
          kind: 'type_contenteditable',
          selectors: [
            'div[data-testid="tweetTextarea_0"]',
            'div[role="textbox"][contenteditable="true"]',
          ],
          text: task.text,
        },
        {
          kind: 'click',
          selectors: [
            'button[data-testid="tweetButtonInline"]',
            'button[data-testid="tweetButton"]',
          ],
          timeout: 10_000,
        },
        {
          kind: 'extract_platform_id',
          selectors: ['article[role="article"] a[href*="/status/"]'],
          attribute: 'href',
        },
      ],
      postCondition: {
        kind: 'selector_visible',
        selectors: ['article[role="article"]'],
        timeout: 6_000,
      },
    };
  },

  reddit: (task) => {
    if (!task.text) return { error: 'TEXT_REQUIRED' };
    return {
      targetUrl: task.target_url,
      steps: [
        {
          kind: 'wait_for_any',
          selectors: [
            '[data-test-id="comment-button"]',
            'textarea[placeholder*="Comment" i]',
            'div[contenteditable="true"][role="textbox"]',
          ],
          timeout: 15_000,
        },
        {
          kind: 'click',
          selectors: ['[data-test-id="comment-button"]'],
          timeout: 6_000,
        },
        {
          kind: 'wait_for_any',
          selectors: [
            ...composerTextarea,
            ...composerContentEditable,
          ],
          timeout: 10_000,
        },
        {
          kind: 'fill',
          selectors: composerTextarea,
          text: task.text,
        },
        {
          kind: 'click',
          selectors: [
            '[data-test-id="comment-submit-button"]',
            'button[type="submit"]',
          ],
          timeout: 10_000,
        },
      ],
      postCondition: {
        kind: 'selector_visible',
        selectors: ['[data-testid="comment"]'],
        timeout: 6_000,
      },
    };
  },
};

const likeScripts: Record<string, ScriptBuilder> = {
  linkedin: (task) => ({
    targetUrl: task.target_url,
    steps: [
      {
        kind: 'wait_for_any',
        selectors: [
          'button[aria-label*="Like" i]',
          'button.react-button__trigger',
          { kind: 'i18n', semanticKey: 'like', role: 'button' },
        ],
        timeout: 15_000,
      },
      {
        kind: 'click',
        selectors: [
          'button[aria-label*="Like" i]:not([aria-pressed="true"])',
          'button.react-button__trigger',
          { kind: 'i18n', semanticKey: 'like', role: 'button' },
        ],
        timeout: 8_000,
      },
    ],
    postCondition: {
      kind: 'selector_visible',
      selectors: [
        'button[aria-label*="Like" i][aria-pressed="true"]',
        'button.react-button__trigger.active',
        { kind: 'i18n', semanticKey: 'unlike', role: 'button' },
      ],
      timeout: 5_000,
    },
  }),

  facebook: (task) => ({
    targetUrl: task.target_url,
    steps: [
      {
        kind: 'wait_for_any',
        selectors: [
          'div[aria-label*="Like" i][role="button"]',
          'button[aria-label*="Like" i]',
          { kind: 'i18n', semanticKey: 'like', role: 'button' },
        ],
        timeout: 15_000,
      },
      {
        kind: 'click',
        selectors: [
          'div[aria-label*="Like" i][role="button"]:not([aria-pressed="true"])',
          'button[aria-label*="Like" i]',
          { kind: 'i18n', semanticKey: 'like', role: 'button' },
        ],
        timeout: 8_000,
      },
    ],
    postCondition: {
      kind: 'selector_visible',
      selectors: [
        'div[aria-pressed="true"][aria-label*="Like" i]',
        '[aria-label*="Liked" i]',
        { kind: 'i18n', semanticKey: 'unlike', role: 'button' },
      ],
      timeout: 5_000,
    },
  }),

  instagram: (task) => ({
    targetUrl: task.target_url,
    steps: [
      {
        kind: 'wait_for_any',
        selectors: [
          'svg[aria-label="Like"]',
          'button svg[aria-label="Like"]',
        ],
        timeout: 15_000,
      },
      {
        kind: 'click',
        selectors: ['button svg[aria-label="Like"]'],
        timeout: 8_000,
      },
    ],
    postCondition: {
      kind: 'selector_visible',
      selectors: ['svg[aria-label="Unlike"]'],
      timeout: 5_000,
    },
  }),

  twitter: (task) => ({
    targetUrl: task.target_url,
    steps: [
      {
        kind: 'wait_for_selector',
        selectors: ['button[data-testid="like"]'],
        timeout: 15_000,
      },
      {
        kind: 'click',
        selectors: ['button[data-testid="like"]'],
        timeout: 8_000,
      },
    ],
    postCondition: {
      kind: 'selector_visible',
      selectors: ['button[data-testid="unlike"]'],
      timeout: 5_000,
    },
  }),

  reddit: (task) => ({
    targetUrl: task.target_url,
    steps: [
      {
        kind: 'wait_for_any',
        selectors: [
          'button[aria-label="upvote"]',
          'button[aria-pressed="false"][aria-label*="upvote" i]',
        ],
        timeout: 15_000,
      },
      {
        kind: 'click',
        selectors: ['button[aria-label="upvote"]'],
        timeout: 8_000,
      },
    ],
    postCondition: {
      kind: 'selector_visible',
      selectors: [
        'button[aria-pressed="true"][aria-label*="upvote" i]',
        'button.upvoted',
      ],
      timeout: 5_000,
    },
  }),
};

export function buildScript(task: RpaTask): RpaScript | { error: string } {
  const platform = task.platform.toLowerCase().trim();
  const action = task.action_type;
  if (action === 'reply') {
    const b = replyScripts[platform];
    if (!b) return { error: 'RPA_PLATFORM_REPLY_NOT_SUPPORTED' };
    return b(task);
  }
  if (action === 'like') {
    const b = likeScripts[platform];
    if (!b) return { error: 'RPA_PLATFORM_LIKE_NOT_SUPPORTED' };
    return b(task);
  }
  return { error: 'RPA_ACTION_TYPE_NOT_SUPPORTED' };
}

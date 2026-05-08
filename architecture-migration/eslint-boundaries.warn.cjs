module.exports = {
  rules: {
    'no-restricted-imports': [
      'warn',
      {
        patterns: [
          {
            group: ['backend/*', '@/backend/*', '../backend/*', '../../backend/*'],
            message: 'WARN ONLY: frontend code must use shared contracts or api clients instead of backend internals.'
          }
        ]
      }
    ]
  }
};

const config = require('eslint-config-sst')

module.exports = {
  env: {
    browser: true,
    es6: true,
    node: true,
    mocha: true,
  },
  plugins: [
    'babel',
    'import',
  ],
  extends: [
    'sst',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/recommended',
  ],
  parserOptions: {
    sourceType: 'module',
  },
  rules: {
    'no-continue': 0,
    // TODO This can up up to eslint-config-sst
    'indent': ['warn', 2, {
      SwitchCase: 1,
      MemberExpression: 1,
      FunctionExpression: {
        body: 1,
        parameters: 2,
      },
      FunctionDeclaration: {
        body: 1,
        parameters: 2,
      },
      CallExpression: {
        arguments: 1,
      },
    }],
    // TODO This can up up to eslint-config-sst
    'class-methods-use-this': ['warn', {
      exceptMethods: [
        'render',
      ],
    }],
    'no-plusplus': 'off',
    'no-process-env': 'off',
    'no-magic-numbers': ['warn', {
      ignore: config.rules['no-magic-numbers'][1].ignore.concat([
        5000,

        500,
        403,
        404,
        200,

        28015,
        6379,
      ])
    }],
    'id-length': ['warn', {
      exceptions: config.rules['id-length'][1].exceptions.concat([
        'a',
        'b',
        's',
        'u',
        //'x',
        'y',
      ])
    }],
    'sort-imports': 'off',
    'import/order': ['warn', {
      'newlines-between': 'always',
    }],

    // Too many false-positives
    // TODO Enable the babel version when its released
    'no-invalid-this': 'off',
    //'babel/no-invalid-this': 'warn',

    //'babel/object-shorthand': 'warn',
    'no-magic-numbers': 'off',
    'max-len': ['warn', 120]
  }
}

const path = require('path');
const baseConfig = require('@aws-cdk/cdk-build-tools/config/eslint.config.js');

module.exports = baseConfig(path.resolve(__dirname));

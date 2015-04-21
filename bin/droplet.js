#!/usr/bin/env node

var options = {
    port: process.env.PORT || 3000,
    logger: require('bunyan').createLogger({ name: 'droplet' })
};

require('../lib/droplet').create_server(options, function (error) {
    if (error) {
        options.logger.error(error, 'droplet server failed to establish listener');
        throw error;
    }
    options.logger.warn({ port: options.port }, 'droplet server started');
});

#!/usr/bin/env node

require('../lib/droplet').create_server({
    port: process.env.PORT || 3000
}, function (error) {
    if (error) throw error;
    console.log('Droplet server listening on port ' + process.env.PORT || 3000);
});

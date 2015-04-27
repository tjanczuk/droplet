var assert = require('assert')
    , droplet = require('../')
    , async = require('async');

var no_log = {
    info: function () {},
    warn: function () {},
    error: function () {},
};

describe('APIs', function () {

    it('are present', function () {
        assert.equal(typeof droplet.create_server, 'function');
        assert.equal(typeof droplet.create_client, 'function');
    });

});

describe('server', function () {

    it('fails to start without port', function (done) {
        try {
            droplet.create_server({}, function (error) {
                done(new Error('unexpected callback'));
            });
        }
        catch (e) {       
            assert.ok(e.message.match(/\`port\` or a \`server\` must be provided/));
            return done();
        }
        done(new Error('unexpected success'));
    });


    it('starts with port', function (done) {
        var server = droplet.create_server({
            port: 31415,
            logger: no_log
        }, function (error) {
            assert.equal(typeof server.close, 'function');
            server.close();
            assert.ifError(error);
            done();
        });
    });

});

describe('client', function () {

    it('fails to create without url', function (done) {
        try {
            droplet.create_client({});
        }
        catch (e) {
            assert.ok(e.message.match(/options\.url must be specified/));
            return done();
        }
        done(new Error('unexpected success'));
    });

    it('creates with url', function (done) {
        var client = droplet.create_client({ 
            url: 'ws://localhost:31415',
            logger: no_log
        });
        assert.ok(client);
        client.close();
        assert.equal(typeof client.close, 'function');
        assert.equal(typeof client.take, 'function');
        done();
    });

});

describe('protocol', function () {

    it('take with ls succeeds', take_limit('ls'));
    it('take with lm succeeds', take_limit('lm'));
    it('take with lh succeeds', take_limit('lh'));
    it('take with ld succeeds', take_limit('ld'));
    it('take with lw succeeds', take_limit('lw'));
    it('take with lo succeeds', take_limit('lo'));
    it('take 5 with ls succeeds', take_limit('ls', 5));
    it('take 5 with lm succeeds', take_limit('lm', 5));
    it('take 5 with lh succeeds', take_limit('lh', 5));
    it('take 5 with ld succeeds', take_limit('ld', 5));
    it('take 5 with lw succeeds', take_limit('lw', 5));
    it('take 5 with lo succeeds', take_limit('lo', 5));

    function take_limit(limit, count) {
        return function (done) {
            var server, client;
            async.series([
                function (callback) {
                    server = droplet.create_server({ port: 31415, logger: no_log }, callback);
                },
                function (callback) {
                    client = droplet.create_client({ 
                        url: 'ws://localhost:31415',
                        logger: no_log
                    });
                    var options = {
                        id: '1',
                        bucket: 'auth0'
                    };
                    if (count)
                        options.count = count;
                    options[limit] = 10;
                    client.take(options, function (error, result) {
                        try {
                            assert.ifError(error);
                            assert.ok(result);
                            assert.equal(typeof result, 'object');
                            assert.equal(result.accept, true);
                            assert.equal(result[limit], 10 - (count || 1));
                        } catch (e) {
                            error = e;
                        }
                        callback(error);
                    });
                }
            ], function (error) {
                if (client) client.close();
                if (server) server.close();
                done(error);
            });
        }
    }

    it('overtake with ls is rejected', overtake_limit('ls'));
    it('overtake with lm is rejected', overtake_limit('lm'));
    it('overtake with lh is rejected', overtake_limit('lh'));
    it('overtake with ld is rejected', overtake_limit('ld'));
    it('overtake with lw is rejected', overtake_limit('lw'));
    it('overtake with lo is rejected', overtake_limit('lo'));

    function overtake_limit(limit) {
        return function (done) {
            var server, client;
            async.series([
                function (callback) {
                    server = droplet.create_server({ port: 31415, logger: no_log }, callback);
                },
                function (callback) {
                    client = droplet.create_client({ 
                        url: 'ws://localhost:31415',
                        logger: no_log
                    });
                    var options = { id: 'foo', bucket: 'auth0' };
                    options[limit] = 1;
                    client.take(options);
                    options = { id: 'bar', bucket: 'auth0' };
                    options[limit] = 1;
                    client.take(options, function (error, result) {
                        try {
                            assert.ifError(error);
                            assert.ok(result);
                            assert.equal(typeof result, 'object');
                            assert.equal(result.accept, false);
                            assert.equal(result[limit], -1);
                        } catch (e) {
                            error = e;
                        }
                        callback(error);
                    });
                }
            ], function (error) {
                if (client) client.close();
                if (server) server.close();
                done(error);
            });
        }
    }

    it('take with ls reduces lm', function (done) {
        var server, client;
        async.series([
            function (callback) {
                server = droplet.create_server({ port: 31415, logger: no_log }, callback);
            },
            function (callback) {
                client = droplet.create_client({ 
                    url: 'ws://localhost:31415',
                    logger: no_log
                });
                client.take({ id: 'foo', bucket: 'auth0', ls: 10, lm: 10 });
                client.take({ id: 'bar', bucket: 'auth0', ls: 10 });
                client.take({ id: 'baz', bucket: 'auth0', lm: 10 }, function (error, result) {
                    try {
                        assert.ifError(error);
                        assert.ok(result);
                        assert.equal(typeof result, 'object');
                        assert.equal(result.accept, true);
                        assert.equal(result.ls, 0);
                        assert.equal(result.lm, 7);
                    } catch (e) {
                        error = e;
                    }
                    callback(error);
                });
            }
        ], function (error) {
            if (client) client.close();
            if (server) server.close();
            done(error);
        });
    });

    it('query works', function (done) {
        var server, client;
        async.series([
            function (callback) {
                server = droplet.create_server({ port: 31415, logger: no_log }, callback);
            },
            function (callback) {
                client = droplet.create_client({ 
                    url: 'ws://localhost:31415',
                    logger: no_log
                });
                client.take({ id: 'foo', bucket: 'auth0', lm: 10, lh: 10 });
                client.take({ id: 'bar', bucket: 'auth0', lm: 10 });
                client.take({ id: 'baz', bucket: 'auth0', lh: 10 });
                client.query({ id: 'q', bucket: 'auth0' }, function (error, result) {
                    try {
                        assert.ifError(error);
                        assert.ok(result);
                        assert.equal(typeof result, 'object');
                        assert.equal(result.accept, undefined);
                        assert.equal(result.lm, 7);
                        assert.equal(result.lh, 7);
                    } catch (e) {
                        error = e;
                    }
                    callback(error);
                });
            }
        ], function (error) {
            if (client) client.close();
            if (server) server.close();
            done(error);
        });
    });

    it('time credits do accumulate', function (done) {
        var server, client;
        async.series([
            function (callback) {
                server = droplet.create_server({ port: 31415, logger: no_log }, callback);
            },
            function (callback) {
                client = droplet.create_client({ 
                    url: 'ws://localhost:31415',
                    logger: no_log
                });
                client.take({ id: 'foo', bucket: 'auth0', lm: 600 });
                for (var i = 0; i < 100; i++)
                    client.take({ id: 'bar' + i, bucket: 'auth0', lm: 600 });
                setTimeout(function () {
                    client.take({ id: 'baz', bucket: 'auth0', lm: 600 }, function (error, result) {
                        try {
                            assert.ifError(error);
                            assert.ok(result);
                            assert.equal(typeof result, 'object');
                            assert.equal(result.accept, true);
                            assert.ok(result.lm > 500);
                        } catch (e) {
                            error = e;
                        }
                        callback(error);
                    });
                }, 1000);
            }
        ], function (error) {
            if (client) client.close();
            if (server) server.close();
            done(error);
        });
    });

    it('time credits do not accumulate beyond rate limit', function (done) {
        var server, client;
        async.series([
            function (callback) {
                server = droplet.create_server({ port: 31415, logger: no_log }, callback);
            },
            function (callback) {
                client = droplet.create_client({ 
                    url: 'ws://localhost:31415',
                    logger: no_log
                });
                client.take({ id: 'foo', bucket: 'auth0', ls: 1000 });
                setTimeout(function () {
                    client.take({ id: 'baz', bucket: 'auth0', lm: 1000 }, function (error, result) {
                        try {
                            assert.ifError(error);
                            assert.ok(result);
                            assert.equal(typeof result, 'object');
                            assert.equal(result.accept, true);
                            assert.equal(result.lm, 999);
                        } catch (e) {
                            error = e;
                        }
                        callback(error);
                    });
                }, 1000);
            }
        ], function (error) {
            if (client) client.close();
            if (server) server.close();
            done(error);
        });
    });

    it('reset limits with zero-take', function (done) {
        var server, client;
        async.series([
            function (callback) {
                server = droplet.create_server({ port: 31415, logger: no_log }, callback);
            },
            function (callback) {
                client = droplet.create_client({ 
                    url: 'ws://localhost:31415',
                    logger: no_log
                });
                for (var i = 0; i < 10; i++)
                    client.take({ id: 'foo' + i, bucket: 'auth0', lm: 20 });
                client.take({ id: 'reset', bucket: 'auth0', lm: 20, reset: true, count: 0 }, function (error, result) {
                    try {
                        assert.ifError(error);
                        assert.ok(result);
                        assert.equal(typeof result, 'object');
                        assert.equal(result.accept, true);
                        assert.equal(result.lm, 20);
                    } catch (e) {
                        error = e;
                    }
                    callback(error);
                });
            }
        ], function (error) {
            if (client) client.close();
            if (server) server.close();
            done(error);
        });
    });

    it('purge buckets with maxed out limits', function (done) {
        var server, client;
        async.series([
            function (callback) {
                server = droplet.create_server({ 
                    port: 31415, 
                    logger: no_log,
                    cleanup_interval: 1
                }, callback);
            },
            function (callback) {
                client = droplet.create_client({ 
                    url: 'ws://localhost:31415',
                    logger: no_log
                });
                server.on('purge', function (bucket) {
                    var error;
                    try {
                        assert.ok(bucket);
                        assert.equal(typeof bucket, 'object');
                        assert.equal(bucket.name, 'auth0');
                    }
                    catch (e) {
                        error = e;
                    }
                    callback(error);
                });
                client.take({ id: 'foo', bucket: 'auth0', lm: 10000 });
            }
        ], function (error) {
            if (client) client.close();
            if (server) server.close();
            done(error);
        });
    });

});

describe('mini stress', function () {

    it('1 bucket, 1000 requests', function (done) {
        var server, client;
        async.series([
            function (callback) {
                server = droplet.create_server({ port: 31415, logger: no_log }, callback);
            },
            function (callback) {
                client = droplet.create_client({ 
                    url: 'ws://localhost:31415',
                    logger: no_log
                });
                var error, accept = true, count = 1000;
                for (var i = 0; i < 1000; i++)
                    client.take({ id: 'foo' + i, bucket: 'auth0', lm: 20000 }, function (e, res) {
                        if (e)
                            error = e;
                        else
                            accept &= res.accept;
                        if (--count === 0) {
                            if (error)
                                callback(error);
                            else if (!accept)
                                callback(new Error('One of the requests was rejected'));
                            else
                                callback();
                        }
                    });
            }
        ], function (error) {
            if (client) client.close();
            if (server) server.close();
            done(error);
        });
    });

    it('1000 buckets, 1 request each', function (done) {
        var server, client;
        async.series([
            function (callback) {
                server = droplet.create_server({ port: 31415, logger: no_log }, callback);
            },
            function (callback) {
                client = droplet.create_client({ 
                    url: 'ws://localhost:31415',
                    logger: no_log
                });
                var error, accept = true, count = 1000;
                for (var i = 0; i < 1000; i++)
                    client.take({ id: 'foo' + i, bucket: 'auth' + i, lm: 20000 }, function (e, res) {
                        if (e)
                            error = e;
                        else
                            accept &= res.accept;
                        if (--count === 0) {
                            if (error)
                                callback(error);
                            else if (!accept)
                                callback(new Error('One of the requests was rejected'));
                            else
                                callback();
                        }
                    });
            }
        ], function (error) {
            if (client) client.close();
            if (server) server.close();
            done(error);
        });
    });

});
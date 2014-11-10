var config = require('./lib/config.js')
var syncer = require('./lib/syncer.js');

config.load('proj.json', syncer.process);
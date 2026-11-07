const { runStoreContract } = require('./contract.js');
const { createMemoryStore } = require('../../api/store/memory.js');

runStoreContract('memory store', async () => createMemoryStore());

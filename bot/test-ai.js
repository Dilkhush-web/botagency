// test-ai.js
const { generateMessage } = require('./src/gemini');

async function test() {
    console.log('Testing Real AI Response...\n');
    const msg = await generateMessage('Rohit Sharma', 'Solar Installation');
    console.log('\n--- AI RESPONSE OUTPUT ---');
    console.log(msg);
}

test();
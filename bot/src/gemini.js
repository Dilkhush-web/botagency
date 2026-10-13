// src/gemini.js
require('dotenv').config();
const Groq = require('groq-sdk');
const { GoogleGenAI } = require('@google/genai');

// 1. Groq Client
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// 2. Google Gemini Client (Failover)
const gemini = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

// Dynamic Natural Human Greetings (Meta anti-pattern randomization)
function getRandomGreeting(cleanName) {
    const greetings = [
        `Hi ${cleanName},`,
        `Hello ${cleanName},`,
        `Hey ${cleanName}, hope you're having a productive week.`,
        `Hi ${cleanName}, quick note regarding your projects:`,
        `Hello ${cleanName}, reached out after noticing your active presence:`
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
}

// Deep Industry Intelligence & Specific Business Bottlenecks
function getNicheContext(niche = '') {
    const n = String(niche).toLowerCase();

    // 1. Real Estate & Builders
    if (n.includes('real estate') || n.includes('property') || n.includes('builder') || n.includes('developer')) {
        return {
            category: 'Real Estate & Property Development',
            painPoint: 'filtering out casual window-shoppers and budget mismatches that drain your sales team’s daily bandwidth',
            solution: 'interactive project landing pages and dynamic WhatsApp pre-qualification funnels that shortlist buyers by verified purchase budget'
        };
    }

    // 2. Doctors, Dental & Healthcare Clinics
    if (n.includes('dent') || n.includes('doctor') || n.includes('clinic') || n.includes('health') || n.includes('medical') || n.includes('hospital')) {
        return {
            category: 'Healthcare & Clinical Practice',
            painPoint: 'prospective patients researching treatments online but dropping off due to delayed manual booking confirmations',
            solution: 'verified digital clinical profiles paired with automated 24/7 WhatsApp consultation scheduling flows'
        };
    }

    // 3. Interior Designers & Architects
    if (n.includes('interior') || n.includes('architect') || n.includes('decor')) {
        return {
            category: 'Interior Design & Architecture',
            painPoint: 'clients inquiring through social media who immediately push for bottom-tier discounts instead of valuing turnkey architectural executions',
            solution: 'interactive 3D concept showcases and client-qualification funnels that establish high-ticket positioning before quotation'
        };
    }

    // 4. Photography & Videography Studios
    if (n.includes('photo') || n.includes('video') || n.includes('studio') || n.includes('wedding')) {
        return {
            category: 'Photography & Creative Studios',
            painPoint: 'leads going cold right after receiving static pricing PDFs and standard portfolio decks',
            solution: 'high-speed interactive portfolio links with instant package-builder calculators that keep prospective clients engaged'
        };
    }

    // 5. Pre-Owned Vehicles / Auto Dealerships
    if (n.includes('vehicle') || n.includes('car') || n.includes('auto') || n.includes('dealer') || n.includes('used') || n.includes('pre-owned')) {
        return {
            category: 'Automobile Dealership & Pre-Owned Vehicles',
            painPoint: 'stagnant showroom visits despite steady online clicks and struggling to commit buyers to actual test drives',
            solution: 'digital inventory catalog funnels integrated with instant WhatsApp test-drive booking and condition inspection sheets'
        };
    }

    // 6. Solar Installation & Renewable Energy
    if (n.includes('solar') || n.includes('energy') || n.includes('renewable')) {
        return {
            category: 'Solar Energy Solutions',
            painPoint: 'residential and commercial leads hesitating and vanishing due to ambiguity around net savings, payback periods, and subsidies',
            solution: 'interactive Solar ROI calculators that instantly quantify financial savings and filter decision-ready property owners'
        };
    }

    // 7. Travel Agencies & Tour Operators
    if (n.includes('travel') || n.includes('tour') || n.includes('holiday') || n.includes('trip')) {
        return {
            category: 'Travel & Tourism Operations',
            painPoint: 'spending hours manually compiling bespoke itineraries only for leads to ghost and comparison-shop elsewhere',
            solution: 'automated interactive itinerary builders with instant quote workflows to lock in traveler interest immediately'
        };
    }

    // 8. B2B Manufacturers & Industrial Suppliers
    if (n.includes('manufactur') || n.includes('factory') || n.includes('industrial') || n.includes('b2b') || n.includes('supplier')) {
        return {
            category: 'B2B Industrial Manufacturing',
            painPoint: 'competing on crowded intermediary portals instead of securing direct procurement contracts from genuine institutional buyers',
            solution: 'technical B2B digital catalogs and dedicated digital RFQ capture funnels engineered for industrial scale'
        };
    }

    return {
        category: 'Business Operations',
        painPoint: 'inflow of unqualified digital inquiries that fail to translate into high-ticket conversions',
        solution: 'modern custom web platforms and automated client acquisition funnels built specifically for conversion'
    };
}

// Dynamic Humanized Fallback (If APIs are completely unreachable)
function getDeepFallback(cleanName, ctx) {
    const greeting = getRandomGreeting(cleanName);
    return `${greeting}

Noticed your active presence in the ${ctx.category} space.

A major recurring challenge we see businesses facing right now is ${ctx.painPoint}.

At AUG Consultancy, we deploy ${ctx.solution}, so your core team only spends time on genuine, qualified prospects.

Would you be open to a brief 2-minute quick connect sometime this week to see if this fits your current setup?

Regards,
Team, AUG Consultancy`;
}

/**
 * 1. Primary Engine: Groq High-Speed Generation
 */
async function generateViaGroq(prompt) {
    if (!groq) return null;

    const models = ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'];

    for (const model of models) {
        try {
            console.log(`⚡ Groq AI Engine (${model}) generating message...`);
            const completion = await groq.chat.completions.create({
                model: model,
                messages: [
                    { 
                        role: "system", 
                        content: "You are an authentic, senior business consultant writing direct, natural B2B messages. Never sound like a generic bot or AI. Output clean, raw text only." 
                    },
                    { role: "user", content: prompt }
                ],
                temperature: 0.65, // Higher entropy for varied, non-repetitive phrasing
                max_tokens: 350
            });

            if (completion && completion.choices[0]?.message?.content) {
                let text = completion.choices[0].message.content.trim();
                text = text.replace(/[*#]/g, '').replace(/^["']|["']$/g, '').trim();
                if (text.length > 70) {
                    console.log(`✨ Groq Generation Successful! (Model: ${model})`);
                    return text;
                }
            }
        } catch (err) {
            console.warn(`⚠️ Groq model ${model} skipped: ${err.message}`);
        }
    }
    return null;
}

/**
 * 2. Secondary Engine: Gemini Failover Generation
 */
async function generateViaGemini(prompt) {
    if (!gemini) return null;

    const geminiModels = ['gemini-3.8-flash'];

    for (const model of geminiModels) {
        try {
            console.log(`🔄 Groq fallback -> Gemini AI Engine (${model}) connecting...`);
            const response = await gemini.models.generateContent({
                model: model,
                contents: prompt
            });

            if (response && response.text) {
                let text = response.text.trim();
                text = text.replace(/[*#]/g, '').replace(/^["']|["']$/g, '').trim();
                if (text.length > 70) {
                    console.log(`✨ Gemini Failover Generation Successful! (Model: ${model})`);
                    return text;
                }
            }
        } catch (err) {
            console.warn(`⚠️ Gemini model ${model} issue: ${err.message}`);
        }
    }
    return null;
}

/**
 * AI Message Generation Engine (Dynamic Human Openings + Dual AI Engine)
 */
async function generateMessage(name, niche, isReply = false, clientMessage = "", stage = "new") {
    const ctx = getNicheContext(niche);
    const cleanName = String(name || '').split(' ')[0].replace(/[^a-zA-Z]/g, '') || 'there';
    const chosenGreeting = getRandomGreeting(cleanName);

    let prompt = "";
    if (isReply) {
        prompt = `
You are the business representative at 'AUG Consultancy' (AfterUs Global).
Client: ${name} (Industry: ${niche})
Client's incoming message: "${clientMessage}"

INBOUND RULES:
1. DETECT CLIENT LANGUAGE:
   - If the client wrote in Hindi or Hinglish, reply politely in natural Hinglish.
   - If the client wrote in English, reply in professional corporate English.
2. Keep it concise (2-4 lines).
3. If technical or custom pricing questions arise, state:
   "I will verify the exact scope with our core technical team and get back to you shortly."
4. If they show interest, propose a brief 5-minute introductory call or Google Meet.
5. Plain text only. No quotes, no markdown symbols.
6. Signature MUST be:
Regards,
Team, AUG Consultancy
`;
    } else {
        prompt = `
Write a sharp, natural, and highly personalized B2B cold outreach WhatsApp message for AUG Consultancy.

Recipient: ${cleanName}
Niche: ${ctx.category}
Identified Bottleneck: ${ctx.painPoint}
Our Concrete Solution: ${ctx.solution}

MANDATORY ANTI-BOT INSTRUCTIONS:
1. GREETING: Start EXACTLY with this line: "${chosenGreeting}" (Do NOT invent your own greeting).
2. NO ROBOTIC CLICHÉS: Strictly NEVER use phrases like "speaking as a founder", "as a founder", "I am reaching out to you", "hope this email finds you well", "in today's fast-paced world", or "game-changer".
3. VARIED PHRASING: Do not write like a templated sales script. Write like an observant tech consultant who genuinely understands how the ${ctx.category} business operates. Talk naturally about how ${ctx.painPoint} can be tackled using ${ctx.solution}.
4. LENGTH: 4 to 6 concise, well-spaced lines. Natural line breaks.
5. LANGUAGE: Plain, sharp corporate English.
6. FORBIDDEN WORDS: Never use 'Free', '100% Guarantee', 'Cheap', 'Discount', 'Best Price', 'Offer', 'Revolutionary'.
7. FORMATTING: Raw text only. DO NOT include quotes (""), asterisks (*), hashtags (#), or subject headers.
8. ENDING: Conclude naturally with:
"Would you be open to a brief 2-minute quick connect sometime this week?"

Regards,
Team, AUG Consultancy
`;
    }

    // Step 1: Try Groq
    const groqResult = await generateViaGroq(prompt);
    if (groqResult) return groqResult;

    // Step 2: Try Gemini Failover
    const geminiResult = await generateViaGemini(prompt);
    if (geminiResult) return geminiResult;

    // Step 3: Guaranteed Human Fallback
    console.log(`🛡️ Deep fallback template active for ${cleanName}`);
    return getDeepFallback(cleanName, ctx);
}

/**
 * Dedicated Multi-Day Follow-Up Generator
 */
async function generateFollowupMessage(name, niche, stage) {
    const ctx = getNicheContext(niche);
    const cleanName = String(name || '').split(' ')[0].replace(/[^a-zA-Z]/g, '') || 'there';

    if (stage === "day21") {
        return `Hello ${cleanName},

It seems this isn't a current priority, so I'll make sure not to crowd your inbox further.

If you ever decide to streamline your lead qualification funnels or web architecture down the road, feel free to reach out anytime.

Wishing you continued success.

Regards,
Team, AUG Consultancy`;
    }

    if (stage === "day7") {
        return `Hi ${cleanName},

We recently helped similar teams in ${ctx.category} filter out non-serious queries and convert higher-intent leads faster.

Would you be open to checking out a 2-minute walkthrough of how the system works?

Regards,
Team, AUG Consultancy`;
    }

    // Default Day 3 follow-up
    return `Hi ${cleanName},

Just checking in to see if my previous note came through regarding your digital lead infrastructure.

Would you be open to a brief 2-minute connect sometime this week?

Regards,
Team, AUG Consultancy`;
}

module.exports = {
    generateMessage,
    generateFollowupMessage
};
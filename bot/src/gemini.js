// src/gemini.js
require('dotenv').config();
const Groq = require('groq-sdk');
const { GoogleGenAI } = require('@google/genai');

// 1. Groq Client
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// 2. Google Gemini Client (Failover)
const gemini = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

// Clean full business name without chopping words or leaving garbage
function cleanBusinessName(rawName) {
    if (!rawName) return 'there';
    let cleaned = String(rawName)
        .replace(/["'(){}[\]]/g, '')
        .replace(/\b\d{10,12}\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || 'there';
}

// 100% Natural, Human-like Consultant Openings (Strictly NO robotic clichés)
function getHumanGreeting(businessName) {
    const greetings = [
        `Hi ${businessName},`,
        `Hello ${businessName},`,
        `Hi ${businessName}, quick observation regarding your digital client flow:`,
        `Hello to the team at ${businessName},`,
        `Hi ${businessName}, came across your work recently:`
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
}

// Deep Industry Intelligence & Specific Business Bottlenecks (Har Niche ka Exact Data)
function getNicheContext(niche = '') {
    const n = String(niche).toLowerCase();

    // 1. Solar & Renewable Energy
    if (n.includes('solar') || n.includes('energy') || n.includes('renewable')) {
        return {
            category: 'Solar Energy & EPC Solutions',
            painPoint: 'sales bandwidth wasted answering leads who lack shadow-free rooftop ownership or sanction load clarity',
            solution: 'interactive Solar Savings & Subsidy qualification calculators that filter out non-viable prospects before your engineering team steps in'
        };
    }

    // 2. Doctors, Healthcare & Specialized Clinics
    if (n.includes('dent') || n.includes('doctor') || n.includes('clinic') || n.includes('health') || n.includes('medical') || n.includes('hospital')) {
        return {
            category: 'Healthcare & Clinical Practice',
            painPoint: 'high inquiry drop-offs and patient no-shows caused by delayed manual chat responses and friction in booking consultations',
            solution: 'instant WhatsApp patient triage and automated appointment booking systems that secure consultations directly on calendar'
        };
    }

    // 3. Real Estate, Builders & Developers
    if (n.includes('real estate') || n.includes('property') || n.includes('builder') || n.includes('developer')) {
        return {
            category: 'Real Estate & Property Development',
            painPoint: 'filtering out casual window-shoppers and budget mismatches that drain your sales team’s daily bandwidth',
            solution: 'interactive project landing pages and dynamic WhatsApp pre-qualification funnels that shortlist buyers by verified purchase budget'
        };
    }

    // 4. Interior Designers & Architects
    if (n.includes('interior') || n.includes('architect') || n.includes('decor')) {
        return {
            category: 'Interior Design & Architecture',
            painPoint: 'clients inquiring through social media who immediately push for bottom-tier discounts instead of valuing turnkey architectural executions',
            solution: 'interactive 3D concept showcases and client-qualification funnels that establish high-ticket positioning before quotation'
        };
    }

    // 5. Photography & Videography Studios
    if (n.includes('photo') || n.includes('video') || n.includes('studio') || n.includes('wedding')) {
        return {
            category: 'Photography & Creative Studios',
            painPoint: 'leads going cold right after receiving static pricing PDFs and standard portfolio decks',
            solution: 'high-speed interactive portfolio links with instant package-builder calculators that keep prospective clients engaged'
        };
    }

    // 6. Pre-Owned Vehicles / Auto Dealerships
    if (n.includes('vehicle') || n.includes('car') || n.includes('auto') || n.includes('dealer') || n.includes('used') || n.includes('pre-owned')) {
        return {
            category: 'Automobile Dealership & Pre-Owned Vehicles',
            painPoint: 'stagnant showroom visits despite steady online clicks and struggling to commit buyers to actual test drives',
            solution: 'digital inventory catalog funnels integrated with instant WhatsApp test-drive booking and condition inspection sheets'
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

    // 9. Universal / Any Random Niche Fallback
    return {
        category: niche || 'Business Operations',
        painPoint: 'inflow of unqualified digital inquiries that fail to translate into high-ticket conversions and waste staff hours',
        solution: 'modern custom web platforms, automated lead qualification funnels, and WhatsApp client onboarding systems built specifically for conversion'
    };
}

// Dynamic Humanized Fallback (If APIs are completely unreachable)
function getDeepFallback(businessName, ctx) {
    const greeting = getHumanGreeting(businessName);
    return `${greeting}

We noticed your active presence in the ${ctx.category} space.

A major recurring operational challenge we see teams facing right now is ${ctx.painPoint}.

At AUG Consultancy (AfterUs Global - afterusglobal.com), we do not push basic templates. We engineer ${ctx.solution}, ensuring your core sales team only spends bandwidth on decision-ready prospects.

Would you be open to a brief 2-minute quick connect sometime this week to see if this fits your setup?

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
                        content: "You are a senior tech & growth consultant representing 'AUG Consultancy' (AfterUs Global - afterusglobal.com). You write observant, consultative, real human-to-human messages. Never sound like a bot, automated script, or marketer. Output clean, raw text only." 
                    },
                    { role: "user", content: prompt }
                ],
                temperature: 0.65, // Controlled natural variation without hallucinating
                max_tokens: 380
            });

            if (completion && completion.choices[0]?.message?.content) {
                let text = completion.choices[0].message.content.trim();
                text = text.replace(/[*#_]/g, '').replace(/^["']|["']$/g, '').trim();
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

    const geminiModels = ['gemini-2.5-flash'];

    for (const model of geminiModels) {
        try {
            console.log(`🔄 Groq fallback -> Gemini AI Engine (${model}) connecting...`);
            const response = await gemini.models.generateContent({
                model: model,
                contents: prompt
            });

            if (response && response.text) {
                let text = response.text.trim();
                text = text.replace(/[*#_]/g, '').replace(/^["']|["']$/g, '').trim();
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
    const businessName = cleanBusinessName(name);
    const ctx = getNicheContext(niche);
    const chosenGreeting = getHumanGreeting(businessName);

    let prompt = "";
    if (isReply) {
        prompt = `
You are the senior technical consultant at 'AUG Consultancy' (AfterUs Global - afterusglobal.com).
Client / Business Name: "${businessName}" (Industry: ${niche || 'Business'})
Client's incoming WhatsApp message: "${clientMessage}"

INBOUND CONSULTING RULES:
1. DETECT CLIENT LANGUAGE:
   - If the client wrote in Hindi or Hinglish, reply politely in crisp, natural conversational Hinglish.
   - If the client wrote in English, reply in professional corporate English.
2. Keep it concise (2-3 lines). Address their exact query with authority.
3. If they ask about custom tech scope, pricing, or technical timelines:
   State clearly: "I will review the exact technical scope with our engineering team and get back to you shortly."
4. If they show interest, propose a brief 5-minute introductory call or Google Meet.
5. Plain text only. Absolutely NO quotes, NO asterisks (*), NO hashtags (#).
6. Signature MUST be:
Regards,
Team, AUG Consultancy
`;
    } else {
        prompt = `
Write a high-converting, deeply consultative B2B WhatsApp message for 'AUG Consultancy' (AfterUs Global - afterusglobal.com).

PROSPECT & CONTEXT:
Target Business Name: "${businessName}"
Target Industry / Niche: ${ctx.category}
Identified Bottleneck / Operational Friction: ${ctx.painPoint}
Our Concrete Solution: ${ctx.solution}

ABOUT AFTERUS GLOBAL (afterusglobal.com):
We are an enterprise digital systems consultancy. We DO NOT push basic websites or generic digital marketing. 
We engineer custom lead qualification architectures, interactive ROI/pricing funnels, and automated WhatsApp intake systems that stop non-serious prospects from wasting sales bandwidth.

MANDATORY WRITING INSTRUCTIONS:
1. GREETING: Start EXACTLY with this line: "${chosenGreeting}" (Do NOT shorten the business name to a single word).
2. NO GENERIC SALES PITCH: Strictly DO NOT say "We make websites" or "Improve your website". Address their specific operational friction (${ctx.painPoint}) and explain how our qualification architecture (${ctx.solution}) protects their team's time.
3. FORBIDDEN CLICHÉS: Never use "as a founder", "hope you're having a productive week", "hope this email finds you well", "I am reaching out to you", "in today's fast-paced world", "game-changer", or "revolutionize".
4. FORBIDDEN WORDS: 'Free', '100% Guarantee', 'Cheap', 'Discount', 'Best Price', 'Offer', 'Revolutionary', 'Skyrocket'.
5. FORMATTING: Raw plain text ONLY. Absolutely NO asterisks (*), hashtags (#), or quotation marks ("").
6. LENGTH: 4 to 5 concise, well-spaced lines with natural line breaks.
7. CLOSING: Conclude naturally with:
Would you be open to a brief 2-minute quick connect sometime this week?

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
    console.log(`🛡️ Deep fallback template active for ${businessName} (${ctx.category})`);
    return getDeepFallback(businessName, ctx);
}

/**
 * Dedicated Multi-Day Follow-Up Generator
 */
async function generateFollowupMessage(name, niche, stage) {
    const businessName = cleanBusinessName(name);
    const ctx = getNicheContext(niche);

    if (stage === "day21") {
        return `Hello ${businessName},

It seems this isn't a current priority for your team, so I'll make sure not to crowd your inbox further.

If you ever decide to streamline your lead qualification systems or digital client intake down the road, feel free to reach out anytime.

Wishing ${businessName} continued success.

Regards,
Team, AUG Consultancy`;
    }

    if (stage === "day7") {
        return `Hi ${businessName},

We recently helped similar teams in the ${ctx.category} space filter out non-serious queries and convert higher-intent clients without back-and-forth manual follow-ups.

Would you be open to checking out a 2-minute walkthrough of how the system works?

Regards,
Team, AUG Consultancy`;
    }

    // Default Day 3 follow-up
    return `Hi ${businessName},

Just checking in to see if my previous note came through regarding your client intake and qualification setup.

Would you be open to a brief 2-minute connect sometime this week?

Regards,
Team, AUG Consultancy`;
}

module.exports = {
    generateMessage,
    generateFollowupMessage
};
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const fs = require('fs');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('CRITICAL ERROR: MONGODB_URI environment variable is missing.');
  process.exit(1);
}

// -------------------------------------------------------------
// SCHEMAS DEFINITION
// -------------------------------------------------------------
const WhatsAppStateSchema = new mongoose.Schema({
  status: { type: String, enum: ['disconnected', 'connecting', 'qr_code', 'ready'], default: 'disconnected' },
  qr: { type: String, default: '' },
  connectedPhone: { type: String, default: '' },
  connectedName: { type: String, default: '' }
}, { timestamps: true });

const ContactSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, default: '' },
  isGroup: { type: Boolean, default: false }
}, { timestamps: true });

const SchedulerSchema = new mongoose.Schema({
  isEnabled: { type: Boolean, default: false },
  targetTime: { type: String, default: '07:30' },
  timezone: { type: String, default: 'Asia/Kolkata' },
  recipientType: { type: String, enum: ['contact', 'group'], default: 'contact' },
  recipientId: { type: String, default: '' },
  recipientName: { type: String, default: '' },
  lastSentDate: { type: String, default: '' },
  lastError: { type: String, default: '' },
  retryCount: { type: Number, default: 0 },
  nextRetryTime: { type: Number, default: 0 },
  triggerTest: { type: Boolean, default: false }
}, { timestamps: true });

const ConfigSchema = new mongoose.Schema({
  apiKey: { type: String, default: '' },
  model: { type: String, default: 'gemini-3.5-flash' },
  customModel: { type: String, default: 'gemini-3.5-flash' },
  thinkingEnabled: { type: Boolean, default: true },
  thinkingBudget: { type: Number, default: 2048 },
  global: {
    dailyCalorieTarget: { type: Number, default: 1600 },
    totalOliveOil: { type: Number, default: 18 },
    oliveOilSplitPercent: { type: Number, default: 50 }
  },
  meals: Array,
  customSplits: Array,
  dailyVariables: Map,
  generationRange: { type: String, default: 'all' },
  selectedGenerationDay: { type: String, default: 'MONDAY' }
}, { timestamps: true });

const WhatsAppState = mongoose.models.WhatsAppState || mongoose.model('WhatsAppState', WhatsAppStateSchema);
const Contact = mongoose.models.Contact || mongoose.model('Contact', ContactSchema);
const Scheduler = mongoose.models.Scheduler || mongoose.model('Scheduler', SchedulerSchema);
const Config = mongoose.models.Config || mongoose.model('Config', ConfigSchema);

// -------------------------------------------------------------
// INITIALIZE DATABASE & WORKER
// -------------------------------------------------------------
console.log('Connecting to MongoDB...');
mongoose.connect(MONGODB_URI, { bufferCommands: false }).then(async () => {
  console.log('Connected to MongoDB successfully.');
  
  // Reset connection state on startup
  await WhatsAppState.findOneAndUpdate(
    {},
    { status: 'disconnected', qr: '', connectedPhone: '', connectedName: '' },
    { upsert: true }
  );

  const store = new MongoStore({ mongoose: mongoose });
  
  // Determine puppeteer executable path
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || 
                         (process.platform === 'linux' ? '/usr/bin/chromium' : undefined);
  
  console.log(`Initializing WhatsApp Client (Chrome Path: ${executablePath || 'default'})...`);

  const client = new Client({
    authStrategy: new RemoteAuth({
      store: store,
      backupSyncIntervalMs: 300000 // Backup session to DB every 5 mins
    }),
    puppeteer: {
      executablePath: executablePath,
      headless: true,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
        '--disable-blink-features=AutomationControlled'
      ],
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    },
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    }
  });

  client.on('remote_session_saved', () => {
    console.log('WhatsApp Remote Session saved to MongoDB store successfully.');
  });

  // -------------------------------------------------------------
  // WHATSAPP EVENT HANDLERS
  // -------------------------------------------------------------
  client.on('qr', async (qr) => {
    console.log('WhatsApp QR Code generated.');
    try {
      const dataUrl = await qrcode.toDataURL(qr);
      await WhatsAppState.findOneAndUpdate(
        {},
        { status: 'qr_code', qr: dataUrl, connectedPhone: '', connectedName: '' },
        { upsert: true }
      );
    } catch (err) {
      console.error('Failed to generate QR data URL:', err);
    }
  });

  client.on('ready', async () => {
    console.log('WhatsApp Client is READY!');
    const phone = client.info.wid.user;
    const name = client.info.pushname || 'Connected Device';
    
    await WhatsAppState.findOneAndUpdate(
      {},
      { status: 'ready', qr: '', connectedPhone: phone, connectedName: name },
      { upsert: true }
    );

    // Sync Contacts in the background
    syncContacts(client);
  });

  client.on('disconnected', async (reason) => {
    console.log('WhatsApp Client disconnected. Reason:', reason);
    await WhatsAppState.findOneAndUpdate(
      {},
      { status: 'disconnected', qr: '', connectedPhone: '', connectedName: '' },
      { upsert: true }
    );
  });

  client.on('auth_failure', async (msg) => {
    console.error('WhatsApp Authentication Failure:', msg);
    await WhatsAppState.findOneAndUpdate(
      {},
      { status: 'disconnected', qr: '' },
      { upsert: true }
    );
  });

  client.on('loading_screen', (percent, message) => {
    console.log(`WhatsApp Client Loading: ${percent}% - ${message}`);
  });

  // Initialize
  client.initialize().catch(err => {
    console.error('Failed to initialize WhatsApp client:', err);
  });

  // Start Scheduler Loop (check every 60 seconds)
  setInterval(() => {
    schedulerCheck(client);
  }, 60000);

}).catch(err => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});

// -------------------------------------------------------------
// SYNC WHATSAPP CONTACTS TO MONGODB
// -------------------------------------------------------------
async function syncContacts(client) {
  try {
    console.log('Fetching WhatsApp chats to cache contacts...');
    const chats = await client.getChats();
    console.log(`Fetched ${chats.length} chats. Syncing to database...`);
    
    for (const chat of chats) {
      if (chat.id && chat.name) {
        await Contact.findOneAndUpdate(
          { id: chat.id._serialized },
          { name: chat.name, isGroup: chat.isGroup },
          { upsert: true }
        );
      }
    }
    console.log('WhatsApp contacts synced successfully.');
  } catch (err) {
    console.error('Failed to sync contacts:', err);
  }
}

// -------------------------------------------------------------
// SCHEDULER CHECK & EXECUTION
// -------------------------------------------------------------
async function schedulerCheck(client) {
  try {
    const scheduler = await Scheduler.findOne();
    if (!scheduler) return;

    // 1. Check if a manual Test Send was triggered
    if (scheduler.triggerTest) {
      console.log('Manual Test Send triggered.');
      // Instantly reset the flag in DB so we don't double-trigger
      await Scheduler.findOneAndUpdate({}, { $set: { triggerTest: false } });
      await executeScheduledSend(client, scheduler, true);
      return;
    }

    // 2. Check if automated sending is enabled
    if (!scheduler.isEnabled) return;

    // 3. Verify recipient configurations
    if (!scheduler.recipientId) {
      console.warn('Daily Scheduler enabled but recipientId is missing.');
      return;
    }

    // 4. Check time and date conditions
    const now = new Date();
    const timezone = scheduler.timezone || 'Asia/Kolkata';
    
    // Format local date: YYYY-MM-DD in target timezone
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    
    // Format local time: HH:MM in target timezone
    const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    
    const [targetHour, targetMinute] = scheduler.targetTime.split(':');
    const [currHour, currMinute] = localTime.split(':');

    // If already sent today, skip
    if (scheduler.lastSentDate === localDate) return;

    // Check if current time is past/equal target time
    const isPastTargetTime = (parseInt(currHour) > parseInt(targetHour)) || 
                             (parseInt(currHour) === parseInt(targetHour) && parseInt(currMinute) >= parseInt(targetMinute));

    if (isPastTargetTime) {
      // Check if we are in a retry cool-down
      if (scheduler.retryCount > 0 && Date.now() < scheduler.nextRetryTime) {
        // Still cooling down from previous failure
        return;
      }

      console.log(`Time match detected! Target: ${scheduler.targetTime}. Current: ${localTime}. Executing scheduled delivery...`);
      await executeScheduledSend(client, scheduler, false);
    }
  } catch (err) {
    console.error('Error in scheduler check loop:', err);
  }
}

// -------------------------------------------------------------
// CORE GENERATION & WHATSAPP TRANSMISSION
// -------------------------------------------------------------
async function executeScheduledSend(client, scheduler, isTest = false) {
  const now = new Date();
  const timezone = scheduler.timezone || 'Asia/Kolkata';
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  
  try {
    // 1. Verify WhatsApp client is connected
    const state = await WhatsAppState.findOne();
    if (!state || state.status !== 'ready') {
      throw new Error('WhatsApp client is not connected / authenticated.');
    }

    // 2. Fetch active diet configuration
    const configDoc = await Config.findOne();
    if (!configDoc || !configDoc.apiKey) {
      throw new Error('Diet configuration or Gemini API Key is missing.');
    }

    // 3. Compile prompt for TODAY
    const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const todayName = DAYS[new Date().getDay()]; // e.g. "FRIDAY"
    
    console.log(`Compiling diet prompt for today (${todayName})...`);
    const prompt = compilePromptTextForDay(configDoc, todayName);

    // 4. Call Gemini API
    console.log('Generating diet plan from Gemini...');
    const generatedText = await callGeminiAPI(configDoc.apiKey, configDoc.model, configDoc.customModel, prompt, configDoc.thinkingEnabled, configDoc.thinkingBudget);
    
    // 5. Extract Part 2 (Cook instructions)
    const messageToSend = extractCookInstructions(generatedText, todayName);

    // 6. Transmit message
    console.log(`Sending WhatsApp message to ${scheduler.recipientName || scheduler.recipientId}...`);
    await client.sendMessage(scheduler.recipientId, messageToSend);
    console.log('WhatsApp message sent successfully!');

    // 7. Update scheduler states on Success
    if (!isTest) {
      await Scheduler.findOneAndUpdate(
        {},
        {
          $set: {
            lastSentDate: localDate,
            lastError: '',
            retryCount: 0,
            nextRetryTime: 0
          }
        }
      );
    } else {
      console.log('Test send execution completed successfully.');
    }
  } catch (error) {
    console.error('Failed to execute scheduled send:', error);
    
    if (!isTest) {
      // Set retry fields: retry in 30 minutes
      const retryCount = (scheduler.retryCount || 0) + 1;
      const nextRetryTime = Date.now() + 30 * 60 * 1000; // 30 minutes in the future
      
      await Scheduler.findOneAndUpdate(
        {},
        {
          $set: {
            lastError: error.message || 'Unknown error',
            retryCount: retryCount,
            nextRetryTime: nextRetryTime
          }
        }
      );
      console.log(`Scheduler updated with retry status. Attempt #${retryCount}. Next retry: ${new Date(nextRetryTime).toLocaleTimeString()}`);
    }
  }
}

// Helper: Compile single-day prompt
function compilePromptTextForDay(c, dayName) {
  const mealsList = c.meals || [];
  const splitsList = c.customSplits || [];
  
  const totalOil = c.global.totalOliveOil || 0;
  const oilPercent = c.global.oliveOilSplitPercent || 50;
  const subjiOil = Math.round(totalOil * oilPercent / 100);
  const chickenOil = totalOil - subjiOil;

  const splitsText = [
    `Olive Oil Cooking Split: ${subjiOil}g in subji. ${chickenOil}g in chicken`,
    ...splitsList.map(s => `${s.name}: ${s.value}`)
  ].map(s => `- ${s}`).join('\n');

  const mealsTargetText = mealsList
    .map((meal, idx) => `- Meal ${idx + 1} (${meal.name}): eaten ${meal.mealsPerDay} times per day`)
    .join('\n');

  const mealsDetailsText = mealsList
    .map((meal, idx) => `
[MEAL ${idx + 1} WEIGHTS: ${meal.name} (FOR 1 MEAL)]
${meal.ingredients.map(ing => `- ${ing.name}: ${ing.isAuto ? '[AUTO]' : `${ing.weight}g`}`).join('\n')}
${meal.water ? `- liquids: ${meal.water}` : ''}
${meal.prepMethod ? `- prep method: ${meal.prepMethod}` : ''}
`).join('\n');

  // Load variables for today
  // Since dailyVariables is a Map in Mongoose schema, we fetch keys
  const dailyVariablesMap = c.dailyVariables || {};
  let todayIngredients = [];
  if (typeof dailyVariablesMap.get === 'function') {
    todayIngredients = dailyVariablesMap.get(dayName) || [];
  } else {
    todayIngredients = dailyVariablesMap[dayName] || [];
  }

  const getDayVariantName = (ingredients) => {
    const nonStapleNames = ingredients
      .filter(ing => !ing.isAuto)
      .map(ing => ing.name);
    if (nonStapleNames.length === 0) return 'Staples Only';
    if (nonStapleNames.length === 1) return `Just ${nonStapleNames[0]}`;
    return nonStapleNames.join(' + ');
  };

  const variant = getDayVariantName(todayIngredients);
  const itemsText = todayIngredients.map(ing => `${ing.name}: ${ing.isAuto ? '[AUTO]' : `${ing.weight}g`}`).join(', ');
  const dailyVariablesText = `- ${dayName} (${variant}): ${itemsText}`;

  return `Act as a strict meal prep calculator and format generator. Below is a centralized configuration section containing weights, targets, and cooking instructions. 

Your task is to automatically calculate all calories using standard nutritional values for raw/uncooked ingredients, round them to the nearest whole number, solve for any ingredients marked as \`[AUTO]\`, and generate a dual-purpose diet plan document.
- PART 1 must be a detailed macro and meal breakdown for myself (using markdown tables and your computed calories). 
- PART 2 must be a raw, copy-pasteable weekly text plan for my cook containing ONLY strict text blocks for each day with absolutely no conversational text, tables, or calorie explanations.

===================================================================
       CONFIGURABLE VARIABLES (EDIT TARGETS, WEIGHTS & SPLITS HERE)
===================================================================

[GLOBAL DIET TARGETS]
- Daily Calorie Target: ${c.global.dailyCalorieTarget} kcal
- Total Daily Olive Oil: ${c.global.totalOliveOil}g (MUST include this globally in daily calorie sum calculations)
${mealsTargetText}

${mealsDetailsText}
[COOK COOKING & SEASONING SPLITS / INSTRUCTIONS]
${splitsText}

[DAILY VARIABLE INGREDIENT WEIGHTS (WHOLE DAY)]
* Note: Use [AUTO] for any ingredient you want the calculator to dynamically scale to hit your exact Daily Calorie Target.
${dailyVariablesText}

===================================================================
                        MATH & OUTPUT GENERATION
===================================================================

INSTRUCTIONS FOR THE CALCULATOR:
1. Estimate the raw/uncooked calorie density (kcal per 1g) for each ingredient using standard USDA nutritional values (e.g. Raw Rice ≈ 3.6 kcal/g, Raw Chicken Breast ≈ 1.2 kcal/g, Olive Oil ≈ 8.75 kcal/g, Eggs ≈ 1.43 kcal/g, Butter ≈ 7.17 kcal/g, Pasta ≈ 3.55 kcal/g, Raw Oats ≈ 3.89 kcal/g, Whey Protein Isolate ≈ 3.7 kcal/g, Almonds ≈ 5.79 kcal/g, Cashews ≈ 5.53 kcal/g, Walnuts ≈ 6.54 kcal/g, Banana ≈ 0.89 kcal/g, Tomato ≈ 0.18 kcal/g, Potato (Raw) ≈ 0.77 kcal/g, Cluster Beans ≈ 0.16 kcal/g, Bottle Gourd ≈ 0.15 kcal/g, Brinjal ≈ 0.25 kcal/g, etc.).
2. For the selected day (${dayName}), sum the calculated calories of all strictly defined weights across all meals and daily variables:
   - Daily calories from meals = Sum over all meals of: (sum of calories of all ingredients in that meal) x (meals per day for that meal)
   - Daily variables calories = sum of calories of all variables for that day
   - Global Olive Oil calories = Total Daily Olive Oil x (calorie density of Olive Oil)
3. Subtract that total (meals + variables + olive oil) from the [Daily Calorie Target] to find the remaining calorie deficit.
4. Convert that remaining calorie deficit into grams for the ingredient(s) marked \`[AUTO]\` using their calorie density to determine their exact weight. 
5. If a day contains multiple \`[AUTO]\` ingredients, split the remaining deficit equally (50-50 in terms of calories) between them, then solve for each weight.
6. For each meal, divide its daily baseline weights and any daily variable weights by the meal's daily frequency to find the per-meal weight.
7. Round all final calculated weights and calories to the nearest whole number so that the day's total hits your target exactly.

---

PART 1: FOR MYSELF (User Breakdown)
Generate this exact section first using markdown tables and bullet points based strictly on your calculations.

${mealsList.map((meal, idx) => `
${idx + 1}. ${meal.name} (${meal.mealsPerDay} Meal${meal.mealsPerDay > 1 ? 's' : ''} Per Day)
Include a markdown table with columns: Ingredient, Weight Per Meal, Daily Total (${meal.mealsPerDay} Meal${meal.mealsPerDay > 1 ? 's' : ''}), Calories (Per Meal). Sum the total calculated calories at the bottom of the table.
`).join('\n')}

For daily variables and splits:
List out only the day ${dayName} using bullet points. Under this day, list ALL fixed items and variable items together, displaying the per-meal weight, daily weight, and calculated calorie breakdown. If an item was calculated via \`[AUTO]\`, replace the \`[AUTO]\` tag with the calculated real weights. Show a calculated "Meal Total" for the day.

Include a Daily Totals (Summary) bulleted section at the bottom of Part 1 aggregating the calculated daily sum total across all meals (and include the global Olive Oil calories) to prove it hits your configured target.

---

PART 2: FOR MY COOK (Weekly Text Plan)
Separate this from Part 1 using a horizontal rule (---). Output only the day ${dayName} using the exact line-by-line template below. Map your calculated total daily weights (including solved \`[AUTO]\` weights) and cooking splits/instructions directly. Absolutely no conversational text, tables, or calorie mentions in this section.

Exact Output Template to Follow:

### ${dayName}: ${variant}
[For each meal, list its ingredients with daily total weights in grams. Then list liquid configuration and prep methods without any hyphen or bullet point prefix. E.g.
"Meal Name:
ingredient1 name 150g
ingredient2 name 100g
liquids: 190g water
prep method: airfryer 200c, 10min"]
[List all custom splits and cooking instructions for each day here, again with no hyphen prefix]
`;
}

// Helper: Call Google Gemini API
async function callGeminiAPI(apiKey, modelName, customModelName, prompt, thinkingEnabled, thinkingBudget) {
  const model = modelName === 'custom' ? customModelName : modelName;
  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: 0.1,
    }
  };

  if (thinkingEnabled) {
    payload.generationConfig.thinkingConfig = {
      thinkingBudget: thinkingBudget || 2048
    };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API returned error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  
  let text = '';
  for (const part of parts) {
    if (!part.thought && part.text) {
      text += part.text;
    }
  }

  if (!text && parts.length > 0) {
    text = parts.map(p => p.text || '').join('');
  }

  return text;
}

// Helper: Extract Part 2 (Cook Instructions) from response markdown
function extractCookInstructions(md, dayName) {
  if (!md) return `No plan generated for ${dayName}.`;

  const splitRegex = /(?:###?\s*)?PART\s*2:\s*FOR\s*MY\s*COOK[^\n]*/i;
  const match = md.match(splitRegex);
  
  let part2 = '';
  if (match && match.index !== undefined) {
    part2 = md.substring(match.index + match[0].length).trim();
    if (part2.startsWith('---')) {
      part2 = part2.substring(3).trim();
    }
  } else {
    // Fallback: split by last horizontal rule
    const sections = md.split('---');
    if (sections.length > 1) {
      part2 = sections[sections.length - 1].trim();
    } else {
      part2 = md.trim();
    }
  }

  // Prepend a nice header for the cook
  return `*Here is today's meal prep plan (${new Date().toLocaleDateString()})*:\n\n${part2}`;
}

// -------------------------------------------------------------
// HTTP HEALTH CHECK SERVER FOR HUGGING FACE SPACES
// -------------------------------------------------------------
const http = require('http');
const server = http.createServer(async (req, res) => {
  try {
    const stateDoc = await WhatsAppState.findOne();
    const schedulerDoc = await Scheduler.findOne();
    
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*' // Allow Vercel frontend to query if needed
    });
    
    res.end(JSON.stringify({ 
      status: 'online', 
      worker: 'whatsapp-worker', 
      whatsapp: stateDoc ? stateDoc.status : 'unknown',
      scheduler: schedulerDoc ? { enabled: schedulerDoc.isEnabled, lastSent: schedulerDoc.lastSentDate } : 'unknown'
    }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error: ' + e.message);
  }
});

const PORT = process.env.PORT || 7860;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP Health check server is listening on port ${PORT}`);
});

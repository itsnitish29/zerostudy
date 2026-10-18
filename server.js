function now() {
    return Date.now();
}
'use strict';
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_PASSWORD_HASH = ADMIN_PASSWORD ? bcrypt.hashSync(ADMIN_PASSWORD, 12) : '';
if (SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters. Copy .env.example to .env and set a strong secret.');
if (ADMIN_PASSWORD.length < 14 || ADMIN_PASSWORD.startsWith('REPLACE_')) throw new Error('Set a unique ADMIN_PASSWORD of at least 14 characters in .env before starting.');

const dbPath = path.resolve(process.env.DB_PATH || './data/gkgs.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS quizzes (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, subject TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 questions_json TEXT NOT NULL, duration_minutes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, original_name TEXT NOT NULL, stored_name TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attempts (
 id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL, quiz_title TEXT NOT NULL, student_name TEXT NOT NULL,
 mobile TEXT NOT NULL, owner_session_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 answers_json TEXT, result_json TEXT, created_at TEXT NOT NULL, submitted_at TEXT,
 FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_attempts_created_at ON attempts(created_at);
CREATE INDEX IF NOT EXISTS idx_attempts_owner ON attempts(owner_session_id);
`);
// Backward-compatible schema migration for existing databases.
const quizCols = db.prepare('PRAGMA table_info(quizzes)').all().map(c => c.name);
if (!quizCols.includes('duration_minutes')) db.exec('ALTER TABLE quizzes ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 0');

// Permanent student attempt ledger: attempts may be updated from pending to submitted, but never deleted.
db.exec(`CREATE TRIGGER IF NOT EXISTS prevent_attempt_delete BEFORE DELETE ON attempts BEGIN SELECT RAISE(ABORT, 'Student attempt records are permanent'); END;`);

// Replace the old demo quizzes with the requested Class 6 & 7 history quiz.
// Existing demo rows are hidden from the quiz catalogue below; historical attempts remain preserved.
const class67Quiz = {"id":"class67-ancient-india-vedic","title":"कक्षा 6 एवं 7 — प्राचीन भारत एवं वैदिक इतिहास","subject":"Class 6 & 7","description":"प्राचीन भारत, इतिहास के स्रोत, सिंधु घाटी सभ्यता और वैदिक इतिहास पर 20 बहुविकल्पीय प्रश्न।","questions":[{"q":"'इण्डिया' (India) शब्द का संबंध मूल रूप से किस संस्कृत शब्द से माना जाता है?","opts":["सिंधु","सरस्वती","भरत","गंगा"],"correct":0,"exp":"India नाम का संबंध सिंधु नदी के नाम से माना जाता है।"},{"q":"संस्कृत शब्द 'सिंधु' से 'इण्डिया' बनने का सही ऐतिहासिक भाषाई क्रम क्या है?","opts":["सिंधु → यूनानी → फारसी → इण्डिया","सिंधु → प्राचीन फारसी (हिंदू) → यूनानी (इण्डोस) → लैटिन व यूरोपीय (इण्डिया)","सिंधु → लैटिन → यूनानी → इण्डिया","सिंधु → भरत → इण्डिया"],"correct":1,"exp":"सिंधु नाम प्राचीन फारसी रूप ‘हिंदू’, यूनानी ‘इण्डोस’ और फिर ‘इण्डिया’ रूप से जुड़ा है।"},{"q":"'भारत' नाम का संबंध प्राचीन भारतीय परंपराओं में वर्णित किस जनसमूह/राजा से जोड़ा जाता है?","opts":["राजा सुदास","राजा पुरु","भरत नामक जनसमूह एवं राजा भरत","महर्षि विश्वामित्र"],"correct":2,"exp":"भारत नाम को परंपरागत रूप से भरत जनसमूह और राजा भरत से जोड़ा जाता है।"},{"q":"भारतीय संविधान के किस अनुच्छेद में देश का आधिकारिक नाम ‘इण्डिया, अर्थात् भारत’ उल्लेखित है?","opts":["अनुच्छेद 1(1)","अनुच्छेद 5","अनुच्छेद 12","अनुच्छेद 352"],"correct":0,"exp":"संविधान के अनुच्छेद 1(1) में ‘India, that is Bharat’ लिखा है।"},{"q":"ऋग्वेद में कुल कितने मण्डल और सूक्त हैं?","opts":["8 मण्डल और 1,000 सूक्त","10 मण्डल और 1,028 सूक्त","12 मण्डल और 10,552 सूक्त","10 मण्डल और 500 सूक्त"],"correct":1,"exp":"ऋग्वेद में 10 मण्डल और परंपरागत गणना के अनुसार 1,028 सूक्त हैं।"},{"q":"प्रसिद्ध ‘दशराज्ञ युद्ध’ का विवरण ऋग्वेद के किस मण्डल में मिलता है?","opts":["तीसरे मण्डल","पाँचवें मण्डल","सातवें मण्डल","दसवें मण्डल"],"correct":2,"exp":"दशराज्ञ युद्ध का वर्णन ऋग्वेद के सातवें मण्डल में मिलता है।"},{"q":"दशराज्ञ युद्ध किस नदी के तट पर लड़ा गया था?","opts":["परुष्णी नदी (आधुनिक रावी)","वितस्ता नदी (झेलम)","सिंधु नदी","नर्मदा नदी"],"correct":0,"exp":"दशराज्ञ युद्ध परुष्णी नदी, जिसे आज रावी नदी कहा जाता है, के निकट हुआ था।"},{"q":"दशराज्ञ युद्ध में भारत जनसमूह के राजा कौन थे और उनके पुरोहित कौन थे?","opts":["राजा सुदास (पुरोहित: महर्षि वशिष्ठ)","राजा पुरु (पुरोहित: महर्षि विश्वामित्र)","राजा भरत (पुरोहित: विश्वामित्र)","राजा सुदास (पुरोहित: महर्षि विश्वामित्र)"],"correct":0,"exp":"इस युद्ध में राजा सुदास के पुरोहित महर्षि वशिष्ठ थे।"},{"q":"दशराज्ञ युद्ध में दस राजाओं के संघ के पुरोहित कौन थे?","opts":["महर्षि वशिष्ठ","महर्षि विश्वामित्र","महर्षि वाल्मीकि","महर्षि वेदव्यास"],"correct":1,"exp":"परंपरागत विवरण में दस राजाओं के संघ का संबंध महर्षि विश्वामित्र से जोड़ा जाता है।"},{"q":"दशराज्ञ युद्ध का अंतिम परिणाम क्या हुआ?","opts":["दस राजाओं के संघ की विजय","राजा सुदास और भारत जनसमूह की निर्णायक विजय","युद्ध अनिर्णीत रहा","दोनों पक्षों में संधि हो गई"],"correct":1,"exp":"ऋग्वैदिक वर्णन में राजा सुदास की विजय का उल्लेख मिलता है।"},{"q":"प्राचीन भारत के इतिहास की जानकारी देने वाले लिखित ग्रंथों और रचनाओं को क्या कहा जाता है?","opts":["पुरातात्विक स्रोत","साहित्यिक स्रोत","अभिलेख","स्मारक"],"correct":1,"exp":"लिखित ग्रंथ और रचनाएँ साहित्यिक स्रोत कहलाते हैं।"},{"q":"पत्थर, स्तंभ, गुफा की दीवार या तांबे की पट्टियों पर खुदे हुए लेखों को क्या कहा जाता है?","opts":["सिक्के","अभिलेख","पांडुलिपि","साहित्यिक स्रोत"],"correct":1,"exp":"कठोर सतहों पर खुदे लेखों को अभिलेख कहा जाता है।"},{"q":"निम्नलिखित में से कौन-सा पुरातात्विक स्रोत का उदाहरण है?","opts":["धार्मिक ग्रंथ","औजार, सिक्के और मूर्तियाँ","ऐतिहासिक रचनाएँ","कविताएँ"],"correct":1,"exp":"औजार, सिक्के और मूर्तियाँ पुरातात्विक स्रोतों के उदाहरण हैं।"},{"q":"नर्मदा नदी के किनारे लोग कितने समय पहले से निवास कर रहे थे?","opts":["100 साल पहले","4,700 साल पहले","8,000 साल पहले","कई लाख साल पहले से"],"correct":3,"exp":"नर्मदा घाटी में मानव निवास के प्रमाण कई लाख वर्ष पुराने हैं।"},{"q":"सुलेमान व किरथर पहाड़ियों में मनुष्यों ने लगभग कितने वर्ष पूर्व गेहूँ व जौ की कृषि आरंभ की थी?","opts":["3,500 वर्ष पूर्व","4,700 वर्ष पूर्व","8,000 वर्ष पूर्व","10,000 वर्ष पूर्व"],"correct":2,"exp":"इन पहाड़ी क्षेत्रों में लगभग 8,000 वर्ष पहले खेती शुरू होने के प्रमाण बताए जाते हैं।"},{"q":"मध्य भारत में स्थित विंध्य पहाड़ियों वाले क्षेत्र में सबसे पहले किस फसल की खेती की गई थी?","opts":["गेहूँ","जौ","चावल","मक्का"],"correct":2,"exp":"विंध्य क्षेत्र में चावल की शुरुआती खेती के प्रमाण बताए जाते हैं।"},{"q":"निम्नलिखित में से कौन-सी नदी सिंधु की सहायक नदी नहीं है?","opts":["झेलम","चेनाब","व्यास","गंगा"],"correct":3,"exp":"गंगा सिंधु की सहायक नदी नहीं है।"},{"q":"सिंधु घाटी सभ्यता का विकास लगभग कितने वर्ष पूर्व हुआ था?","opts":["8,000 साल पहले","4,700 साल पहले","3,500 साल पहले","1,000 साल पहले"],"correct":1,"exp":"स्कूली इतिहास की सामान्य समयरेखा में सिंधु घाटी सभ्यता लगभग 4,700 वर्ष पहले विकसित हुई मानी जाती है।"},{"q":"अभिलेखों से मुख्य रूप से किस प्रकार की जानकारी प्राप्त होती है?","opts":["शासकों, उनके आदेशों, दान और उस समय की भाषा की","केवल मौसम की","आधुनिक तकनीक की","केवल नदियों के मार्ग की"],"correct":0,"exp":"अभिलेखों से शासकों, आदेशों, दान, प्रशासन और भाषा के बारे में जानकारी मिल सकती है।"},{"q":"ऋग्वेद में कुल कितनी ऋचाएँ (मंत्र) संग्रहित हैं?","opts":["1,028","10,552","8,000","4,700"],"correct":1,"exp":"ऋग्वेद में लगभग 10,552 ऋचाएँ/मंत्र माने जाते हैं।"}]};
const existingClass67 = db.prepare('SELECT id FROM quizzes WHERE id = ?').get(class67Quiz.id);
if (!existingClass67) {
 const stamp = Date.now();
 db.prepare('INSERT INTO quizzes (id,title,subject,description,questions_json,duration_minutes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
  .run(class67Quiz.id, class67Quiz.title, class67Quiz.subject, class67Quiz.description, JSON.stringify(class67Quiz.questions), 20, stamp, stamp);
}

// Seed the requested Class 8 GK quiz once. Existing quizzes and student records are left untouched.
const class8GkQuiz = {"id":"class8-gk-history-sources","title":"कक्षा 8 GK क्विज़ — इतिहास एवं ऐतिहासिक स्रोत","subject":"Class 8 GK","description":"कक्षा 8 के इतिहास अध्याय ‘कैसे, कब और कहाँ’ से संबंधित 20 बहुविकल्पीय प्रश्न।","questions":[{"q":"जेम्स मिल कहाँ के रहने वाले थे?","opts":["भारत","स्कॉटलैंड","अमेरिका","चीन"],"correct":1,"exp":"जेम्स मिल स्कॉटलैंड के इतिहासकार और दार्शनिक थे।"},{"q":"अंग्रेजों द्वारा किया गया इतिहास का धार्मिक विभाजन (हिंदू, मुस्लिम, ब्रिटिश) कैसा माना जाता है?","opts":["बहुत अच्छा और वैज्ञानिक","अवैज्ञानिक, अतार्किक व असंगत","पूरी तरह सही","इनमें से कोई नहीं"],"correct":1,"exp":"इतिहास को केवल धर्म के आधार पर बाँटना समाज और ऐतिहासिक बदलावों की जटिलता को ठीक से नहीं दर्शाता।"},{"q":"'औपनिवेशीकरण' (Colonization) किसे कहते हैं?","opts":["जब एक देश दूसरे देश के प्रभाव में आकर वहाँ राजनीतिक, आर्थिक, सामाजिक व सांस्कृतिक बदलाव देखता है","जब दो देश आपस में व्यापार करते हैं","जब देश में नए खेल खेले जाते हैं","जब लोग एक जगह से दूसरी जगह घूमने जाते हैं"],"correct":0,"exp":"औपनिवेशीकरण में एक देश दूसरे क्षेत्र पर नियंत्रण स्थापित कर वहाँ राजनीतिक, आर्थिक और सामाजिक बदलाव लाता है।"},{"q":"भारत धीरे-धीरे किसका गुलाम बन गया था?","opts":["अंग्रेजों का","फ्रांसीसियों का","पुर्तगालियों का","डच लोगों का"],"correct":0,"exp":"ब्रिटिश ईस्ट इंडिया कंपनी और बाद में ब्रिटिश शासन ने भारत के बड़े हिस्से पर नियंत्रण स्थापित किया।"},{"q":"अंग्रेजों के रिकॉर्ड रखने के तरीके में क्या-क्या शामिल था?","opts":["फैसले लेना व लिखना","नियम और योजनाएं बनाना","पूछताछ और जाँच करना","उपर्युक्त सभी"],"correct":3,"exp":"औपनिवेशिक प्रशासन में फैसले, नियम, योजनाएँ, जाँच और रिपोर्टें दर्ज की जाती थीं।"},{"q":"महत्वपूर्ण दस्तावेजों और ऐतिहासिक चीज़ों को सुरक्षित कहाँ रखा जाता है?","opts":["रसोई घर में","तिजोरी, संग्रहालय और अभिलेखागार में","खेल के मैदान में","नदी में"],"correct":1,"exp":"ऐतिहासिक दस्तावेज़ अभिलेखागार में और वस्तुएँ संग्रहालयों में सुरक्षित रखी जाती हैं।"},{"q":"'भारतीय राष्ट्रीय अभिलेखागार' (National Archives of India) की स्थापना मुख्य रूप से किस दशक के आसपास सामने आई?","opts":["1920 के दशक में","1857 में","1947 में","2000 में"],"correct":0,"exp":"दिए गए पाठ्य-संदर्भ के अनुसार राष्ट्रीय अभिलेखागार की इमारत 1920 के दशक में सामने आई।"},{"q":"अंग्रेजों ने देश पर ठीक से शासन चलाने के लिए देश में क्या करवाए थे?","opts":["सर्वेक्षण (Surveys)","मेले","कुश्ती प्रतियोगिता","संगीत कार्यक्रम"],"correct":0,"exp":"सर्वेक्षणों से भूमि, संसाधनों, जनसंख्या और प्रशासन से जुड़ी जानकारी जुटाई जाती थी।"},{"q":"निम्नलिखित में से कौन-सा सर्वेक्षण अंग्रेजों द्वारा करवाया गया था?","opts":["राजस्व सर्वेक्षण (Revenue Survey)","जनगणना (Census)","प्राणी विज्ञान व मानवशास्त्रीय सर्वेक्षण","उपर्युक्त सभी"],"correct":3,"exp":"औपनिवेशिक शासन में राजस्व, जनसंख्या, प्राणी विज्ञान और मानवशास्त्र से जुड़े सर्वेक्षण हुए।"},{"q":"आधिकारिक (सरकारी) रिकॉर्ड की मुख्य सीमा या कमी क्या थी?","opts":["वे सिर्फ अंग्रेजों के नजरिए और उनकी सोच को बताते थे","वे आम भारतीयों की असली स्थिति को पूरी तरह स्पष्ट नहीं करते थे","(A) और (B) दोनों सही हैं","इनमें से कोई नहीं"],"correct":2,"exp":"सरकारी रिकॉर्ड प्रशासन का दृष्टिकोण दिखाते हैं; वे आम लोगों के अनुभवों को पूरी तरह नहीं बताते।"},{"q":"पारंपरिक इतिहास में सबसे ज्यादा ध्यान किस पर दिया जाता था?","opts":["राजाओं, युद्धों और तारीखों पर","आम किसानों के जीवन पर","बच्चों की पढ़ाई पर","मौसम पर"],"correct":0,"exp":"पारंपरिक राजनीतिक इतिहास में अक्सर शासकों, युद्धों और तारीखों पर अधिक ध्यान दिया जाता था।"},{"q":"इतिहास में होने वाले बदलाव कैसे होते हैं?","opts":["एक पल में","धीरे-धीरे (क्रमिक विकास के रूप में)","कभी नहीं होते","जादुई तरीके से"],"correct":1,"exp":"कई ऐतिहासिक बदलाव लंबे समय में धीरे-धीरे विकसित होते हैं।"},{"q":"इतिहास में तारीखों का महत्व कब बदल जाता है?","opts":["जब हमारा परिप्रेक्ष्य (सोच या देखने का नजरिया) बदल जाता है","जब घड़ी खराब हो जाती है","जब नया महीना शुरू होता है","कभी नहीं बदलता"],"correct":0,"exp":"नए प्रश्नों और दृष्टिकोणों के कारण इतिहासकारों के लिए कुछ तारीखों का महत्व बदल सकता है।"},{"q":"ब्रिटिश इतिहास को अंग्रेजों का इतिहास कहा जाता है, न कि किसका इतिहास?","opts":["ईसाई इतिहास","जैन इतिहास","बौद्ध इतिहास","सिख इतिहास"],"correct":0,"exp":"यह प्रश्न इतिहास को धर्म के इतिहास से अलग समझने के संदर्भ में है।"},{"q":"समाज और संस्कृति के विकास को समझने में किससे मदद मिलती है?","opts":["इतिहास के स्रोतों और रिकॉर्ड्स से","कार्टून देखने से","वीडियो गेम खेलने से","सोने से"],"correct":0,"exp":"विभिन्न स्रोतों और रिकॉर्डों से समाज और संस्कृति में आए बदलावों को समझा जा सकता है।"},{"q":"अंग्रेजों के रिकॉर्ड रखने के तरीकों में इनमें से क्या एक हिस्सा था?","opts":["रिपोर्ट तैयार करना","गाने रिकॉर्ड करना","तस्वीरें बेचना","फिल्में बनाना"],"correct":0,"exp":"रिपोर्टें औपनिवेशिक प्रशासन में जानकारी दर्ज करने का एक महत्वपूर्ण तरीका थीं।"},{"q":"ब्रिटिश काल में लोगों की गिनती (संख्या, जाति, धर्म आदि जानने के लिए) को क्या कहा जाता है?","opts":["जनगणना","गिनती का तारा","गणित का पेपर","स्कोरबोर्ड"],"correct":0,"exp":"जनगणना में जनसंख्या से जुड़ी जानकारी व्यवस्थित रूप से दर्ज की जाती है।"},{"q":"इतिहास में हम मुख्य रूप से क्या जानने का प्रयास करते हैं?","opts":["कब, कहाँ और कैसे क्या हुआ था","कल क्या बारिश होगी","बाजार में सब्जी का भाव","कौन-सी फिल्म आने वाली है"],"correct":0,"exp":"इतिहास में घटनाओं के समय, स्थान, कारण और उनके प्रभावों को समझने का प्रयास किया जाता है।"},{"q":"नोट्स के अनुसार, ब्रिटिश इतिहास के अंतर्गत किसका इतिहास मुख्य रूप से पढ़ाया जाता है?","opts":["अंग्रेजों का शासनकाल","केवल राजाओं की कहानियां","अंतरिक्ष यात्रियों का जीवन","खिलाड़ियों की सूची"],"correct":0,"exp":"इस प्रश्न के दिए गए नोट्स के अनुसार विषय ब्रिटिश शासनकाल पर केंद्रित है।"},{"q":"पुराने समय की बातों और दस्तावेजों को संभाल कर रखने वाली जगह को क्या कहते हैं?","opts":["अभिलेखागार (Archives)","खेल का मैदान","बस स्टैंड","सिनेमा हॉल"],"correct":0,"exp":"अभिलेखागार में पुराने सरकारी दस्तावेज़ और रिकॉर्ड सुरक्षित रखे जाते हैं।"}]};
if (!db.prepare('SELECT id FROM quizzes WHERE id = ?').get(class8GkQuiz.id)) {
const stamp = Date.now();
 db.prepare('INSERT INTO quizzes (id,title,subject,description,questions_json,duration_minutes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
  .run(class8GkQuiz.id, class8GkQuiz.title, class8GkQuiz.subject, class8GkQuiz.description, JSON.stringify(class8GkQuiz.questions), 20, stamp, stamp);
}

app.disable('x-powered-by');
if (isProd) app.set('trust proxy', 1);
app.use(helmet({
 contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], baseUri: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"],
  scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], formAction: ["'self'"]
 } }, crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '100kb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(session({
 name: 'gkgs.sid', secret: SESSION_SECRET, resave: false, saveUninitialized: false,
 store: new SQLiteStoreFactory({ db: 'sessions.sqlite', dir: path.dirname(dbPath), table: 'sessions' }),
 cookie: { httpOnly: true, secure: isProd, sameSite: 'strict', maxAge: 1000 * 60 * 60 * 8 }
}));

// Admin-uploaded photos and PDFs. Use persistent storage in production.
const uploadsDir = path.resolve(process.env.UPLOADS_DIR || './data/uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
// Automatic SQLite snapshots on the same persistent disk. Keep the newest 30 daily snapshots.
const backupsDir = path.resolve(process.env.BACKUPS_DIR || path.join(path.dirname(dbPath), 'backups'));
fs.mkdirSync(backupsDir, { recursive: true });
let backupRunning = false;
async function createDatabaseBackup() {
 if (backupRunning) return;
 backupRunning = true;
 const destination = path.join(backupsDir, `gkgs-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
 try {
  await db.backup(destination);
  const files = fs.readdirSync(backupsDir).filter(name => /^gkgs-.*\.sqlite$/.test(name)).sort().reverse();
  for (const oldFile of files.slice(30)) fs.unlink(path.join(backupsDir, oldFile), () => {});
  console.log('Database backup created:', path.basename(destination));
 } catch (error) {
  console.error('Database backup failed:', error.message);
  try { fs.unlinkSync(destination); } catch {}
 } finally { backupRunning = false; }
}
// Create one at startup and then once per day. The disk must be persistent on the hosting provider.
createDatabaseBackup();
const backupTimer = setInterval(createDatabaseBackup, 24 * 60 * 60 * 1000);
if (backupTimer.unref) backupTimer.unref();
const allowedUploadTypes = new Map([['application/pdf','.pdf'],['image/jpeg','.jpg'],['image/png','.png'],['image/webp','.webp'],['image/gif','.gif']]);
const upload = multer({
 storage: multer.diskStorage({ destination: (_req,_file,cb)=>cb(null,uploadsDir), filename: (_req,file,cb)=>cb(null,crypto.randomUUID()+allowedUploadTypes.get(file.mimetype)) }),
 limits: { fileSize: 12 * 1024 * 1024, files: 1 },
 fileFilter: (_req,file,cb)=>allowedUploadTypes.has(file.mimetype) ? cb(null,true) : cb(new Error('केवल PDF, JPG, PNG, WEBP या GIF फाइल अपलोड करें।'))
});
// Same-origin checks + custom header on all state-changing API requests.
app.use('/api', (req, res, next) => {
 if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
 const origin = req.get('origin');
 if (origin) {
  try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Cross-origin request blocked.' }); }
  catch { return res.status(403).json({ error: 'Invalid request origin.' }); }
 }
 if (req.get('x-requested-with') !== 'GKGSQuiz') return res.status(403).json({ error: 'Request verification failed.' });
 next();
});
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'बहुत अधिक login प्रयास हुए हैं। 15 मिनट बाद फिर कोशिश करें।' } });
const attemptLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'बहुत अधिक प्रयास हुए हैं। थोड़ी देर बाद कोशिश करें।' } });
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const cleanText = (v, max = 200) => typeof v === 'string' ? v.trim().slice(0, max) : '';
function adminOnly(req, res, next) { if (req.session?.role !== 'admin') return res.status(403).json({ error: 'यह सुविधा केवल Admin के लिए है।' }); next(); }
function validQuiz(payload) {
 if (!payload || typeof payload !== 'object') return 'Invalid quiz data.';
 const title = cleanText(payload.title, 120), subject = cleanText(payload.subject, 60), description = cleanText(payload.description, 500);
 if (title.length < 2 || subject.length < 2) return 'क्विज़ का शीर्षक और विषय आवश्यक हैं।';
 const duration = Number(payload.durationMinutes ?? 0); if (!Number.isInteger(duration) || duration < 0 || duration > 600) return 'समय 0 (बिना सीमा) या 1 से 600 मिनट के बीच रखें।';
 if (!Array.isArray(payload.questions) || payload.questions.length < 1 || payload.questions.length > 100) return 'क्विज़ में 1 से 100 प्रश्न होने चाहिए।';
 for (let i = 0; i < payload.questions.length; i++) {
  const q = payload.questions[i];
  if (!q || cleanText(q.q, 1000).length < 2 || !Array.isArray(q.opts) || q.opts.length !== 4 || q.opts.some(o => cleanText(o, 300).length < 1) || !Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) return `प्रश्न ${i + 1} में त्रुटि है। प्रश्न, चार विकल्प और सही उत्तर जाँचें।`;
 }
 return null;
}
function normalizeQuiz(q) { return { id: q.id, title: q.title, subject: q.subject, description: q.description, durationMinutes: q.duration_minutes || 0, questions: q.questions, createdAt: q.created_at, updatedAt: q.updated_at }; }
function dbQuiz(row) { return { ...row, questions: JSON.parse(row.questions_json) }; }
function publicQuiz(row) {
 const q = dbQuiz(row);
 return { id: q.id, title: q.title, subject: q.subject, description: q.description, durationMinutes: q.duration_minutes || 0, questionCount: q.questions.length,
  questions: q.questions.map(x => ({ q: x.q, opts: x.opts })) };
}

app.get('/api/session', (req, res) => res.json({ role: req.session?.role === 'admin' ? 'admin' : 'student' }));
app.post('/api/admin/login', loginLimiter, async (req, res, next) => {
 try {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const ok = password.length <= 256 && await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  if (!ok) return res.status(401).json({ error: 'गलत पासवर्ड।' });
  req.session.regenerate(err => {
   if (err) return next(err);
   req.session.role = 'admin';
   req.session.authenticatedAt = Date.now();
   req.session.save(err2 => err2 ? next(err2) : res.json({ ok: true, role: 'admin' }));
  });
 } catch (e) { next(e); }
});
app.post('/api/logout', (req, res, next) => req.session.destroy(err => { if (err) return next(err); res.clearCookie('gkgs.sid', { httpOnly: true, sameSite: 'strict', secure: isProd }); res.json({ ok: true }); }));

app.get('/api/quizzes', (req, res) => {
 const rows = db.prepare("SELECT * FROM quizzes WHERE id NOT IN ('demo-gk','demo-science','demo-maths') ORDER BY created_at DESC").all();
 res.json({ quizzes: rows.map(row => req.session?.role === 'admin' ? normalizeQuiz(dbQuiz(row)) : publicQuiz(row)) });
});
app.post('/api/quizzes', adminOnly, (req, res) => {
 const error = validQuiz(req.body); if (error) return res.status(400).json({ error });
 const t = now(), quizId = id(), title = cleanText(req.body.title, 120), subject = cleanText(req.body.subject, 60), description = cleanText(req.body.description, 500), duration = Number(req.body.durationMinutes ?? 0);
 const questions = req.body.questions.map(q => ({ q: cleanText(q.q, 1000), opts: q.opts.map(o => cleanText(o, 300)), correct: q.correct, exp: cleanText(q.exp, 1000) }));
 db.prepare('INSERT INTO quizzes (id,title,subject,description,questions_json,duration_minutes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(quizId,title,subject,description,JSON.stringify(questions),duration,t,t);
 res.status(201).json({ quiz: { id: quizId, title, subject, description, questions } });
});
app.put('/api/quizzes/:id', adminOnly, (req, res) => {
 const old = db.prepare('SELECT * FROM quizzes WHERE id=?').get(req.params.id); if (!old) return res.status(404).json({ error: 'क्विज़ नहीं मिला।' });
 const error = validQuiz(req.body); if (error) return res.status(400).json({ error });
 const title = cleanText(req.body.title,120), subject = cleanText(req.body.subject,60), description = cleanText(req.body.description,500), duration = Number(req.body.durationMinutes ?? 0);
 const questions = req.body.questions.map(q => ({ q: cleanText(q.q,1000), opts:q.opts.map(o=>cleanText(o,300)), correct:q.correct, exp:cleanText(q.exp,1000) }));
 db.prepare('UPDATE quizzes SET title=?,subject=?,description=?,questions_json=?,duration_minutes=?,updated_at=? WHERE id=?').run(title,subject,description,JSON.stringify(questions),duration,now(),req.params.id);
 res.json({ ok:true });
});
app.delete('/api/quizzes/:id', adminOnly, (req,res) => {
 const used = db.prepare('SELECT 1 FROM attempts WHERE quiz_id=? LIMIT 1').get(req.params.id);
 if (used) return res.status(409).json({ error:'इस क्विज़ के प्रयास रिकॉर्ड में हैं, इसलिए इसे delete नहीं किया जा सकता।' });
 const info = db.prepare('DELETE FROM quizzes WHERE id=?').run(req.params.id); if (!info.changes) return res.status(404).json({ error:'क्विज़ नहीं मिला।' }); res.json({ok:true});
});

app.post('/api/attempts', attemptLimiter, (req,res) => {
 const quizId = cleanText(req.body?.quizId, 80), name = cleanText(req.body?.name, 100), mobile = cleanText(req.body?.mobile, 10);
 if (name.length < 2) return res.status(400).json({ error:'विद्यार्थी का नाम दर्ज करें।' });
 if (!/^[6-9][0-9]{9}$/.test(mobile)) return res.status(400).json({ error:'सही 10 अंकों का भारतीय मोबाइल नंबर दर्ज करें।' });
 const quiz = db.prepare('SELECT * FROM quizzes WHERE id=?').get(quizId); if (!quiz) return res.status(404).json({error:'क्विज़ उपलब्ध नहीं है।'});
 const attemptId = id(), timestamp = now();
 db.prepare('INSERT INTO attempts (id,quiz_id,quiz_title,student_name,mobile,owner_session_id,status,created_at) VALUES (?,?,?,?,?,?,?,?)').run(attemptId,quizId,quiz.title,name,mobile,req.sessionID,'pending',timestamp);
 req.session.studentSession = true;
 req.session.save(err => { if (err) return res.status(500).json({error:'Session save नहीं हो सका।'}); res.status(201).json({ attemptId, quiz: publicQuiz(quiz) }); });
});
app.post('/api/attempts/:id/submit', attemptLimiter, (req,res) => {
 const attempt = db.prepare('SELECT * FROM attempts WHERE id=?').get(req.params.id);
 if (!attempt || attempt.owner_session_id !== req.sessionID || attempt.status !== 'pending') return res.status(404).json({error:'यह टेस्ट सत्र उपलब्ध नहीं है या पहले ही सबमिट हो चुका है।'});
 const quiz = db.prepare('SELECT * FROM quizzes WHERE id=?').get(attempt.quiz_id); if (!quiz) return res.status(404).json({error:'क्विज़ उपलब्ध नहीं है।'});
 const questions = JSON.parse(quiz.questions_json);
 const durationMs = Math.max(0, Number(quiz.duration_minutes || 0)) * 60000;
 const expired = durationMs > 0 && (Date.now() - new Date(attempt.created_at).getTime()) >= durationMs;
 let incoming = req.body?.answers;
 if (expired) incoming = Array(questions.length).fill(null);
 if (!Array.isArray(incoming) || incoming.length !== questions.length || incoming.some(a => a !== null && (!Number.isInteger(a) || a < 0 || a > 3))) return res.status(400).json({error:'उत्तर डेटा अमान्य है।'});
 let correct=0,wrong=0,skip=0;
 const review = questions.map((q,i)=>{const user=incoming[i];const result=user===null?'skip':user===q.correct?'correct':'wrong';if(result==='correct')correct++;else if(result==='wrong')wrong++;else skip++;return {q:q.q,opts:q.opts,correct:q.correct,exp:q.exp||'इस प्रश्न से संबंधित कॉन्सेप्ट दोहराएँ।',user,result};});
 const result = { attemptId:attempt.id, quizId:quiz.id, studentName:attempt.student_name, title:quiz.title, subject:quiz.subject, total:questions.length, correct, wrong, skip, score:Math.round(correct/questions.length*100), date:now(), autoSubmitted:expired, questions:review };
 db.prepare('UPDATE attempts SET status=?,answers_json=?,result_json=?,submitted_at=? WHERE id=? AND status=?').run('submitted',JSON.stringify(incoming),JSON.stringify(result),now(),attempt.id,'pending');
 res.json({ result });
});
app.get('/api/my-results/:id', (req,res) => {
 const row = db.prepare('SELECT * FROM attempts WHERE id=?').get(req.params.id);
 if (!row || (req.session?.role !== 'admin' && row.owner_session_id !== req.sessionID) || row.status !== 'submitted') return res.status(404).json({error:'रिजल्ट नहीं मिला।'});
 res.json({ result: JSON.parse(row.result_json) });
});
app.get('/api/admin/database-backup', adminOnly, async (_req,res) => {
 const destination = path.join(backupsDir, `gkgs-manual-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
 try {
  await db.backup(destination);
  res.download(destination, 'GKGS_Quiz_Database_Backup.sqlite', err => {
   fs.unlink(destination, () => {});
   if (err && !res.headersSent) res.status(500).end('Backup download failed.');
  });
 } catch (error) {
  console.error('Manual database backup failed:', error.message);
  res.status(500).json({error:'Database backup नहीं बन पाया।'});
 }
});

app.get('/api/admin/attempts', adminOnly, (req,res) => {
 const rows = db.prepare("SELECT id,quiz_id,quiz_title,student_name,mobile,status,created_at,submitted_at,result_json FROM attempts ORDER BY created_at DESC LIMIT 5000").all();
 res.json({ attempts: rows.map(r=>({id:r.id,quizId:r.quiz_id,title:r.quiz_title,studentName:r.student_name,mobile:r.mobile,status:r.status,date:r.submitted_at||r.created_at,...(r.result_json?{score:JSON.parse(r.result_json).score,correct:JSON.parse(r.result_json).correct,wrong:JSON.parse(r.result_json).wrong,total:JSON.parse(r.result_json).total}:{})})) });
});
app.get('/api/admin/attempts.csv', adminOnly, (req,res) => {
 const rows = db.prepare("SELECT quiz_title,student_name,mobile,status,created_at,submitted_at,result_json FROM attempts ORDER BY created_at DESC LIMIT 5000").all();
 const fields = ['Student Name','Mobile','Quiz','Status','Score %','Correct','Wrong','Total','Created At','Submitted At'];
 const quote = v => '"'+String(v??'').replace(/"/g,'""')+'"';
 const lines=[fields.map(quote).join(',')];
 for(const r of rows){const x=r.result_json?JSON.parse(r.result_json):{};lines.push([r.student_name,r.mobile,r.quiz_title,r.status,x.score??'',x.correct??'',x.wrong??'',x.total??'',r.created_at,r.submitted_at].map(quote).join(','));}
 res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="GKGS_Quiz_Student_Results.csv"');res.send('\ufeff'+lines.join('\r\n'));
});

// Learning materials: students can view/download, only Admin can upload/delete.
app.get('/api/materials', (_req,res)=>{
 const rows=db.prepare('SELECT id,title,category,original_name,mime_type,size_bytes,created_at FROM materials ORDER BY created_at DESC').all();
 res.json({materials:rows.map(r=>({...r,url:'/uploads/'+encodeURIComponent(db.prepare('SELECT stored_name FROM materials WHERE id=?').get(r.id).stored_name)}))});
});
app.post('/api/admin/materials', adminOnly, (req,res)=>upload.single('file')(req,res,err=>{
 if(err) return res.status(400).json({error:err.code==='LIMIT_FILE_SIZE'?'फाइल 12 MB से छोटी होनी चाहिए।':err.message||'फाइल अपलोड नहीं हुई।'});
 if(!req.file) return res.status(400).json({error:'फाइल चुनें।'});
 const title=cleanText(req.body.title,120), category=cleanText(req.body.category,40);
 if(title.length<2 || !['PDF','Photo'].includes(category)){fs.unlink(req.file.path,()=>{});return res.status(400).json({error:'शीर्षक और सही category भरें।'});}
 const row={id:id(),title,category,original_name:path.basename(req.file.originalname).slice(0,180),stored_name:req.file.filename,mime_type:req.file.mimetype,size_bytes:req.file.size,created_at:now()};
 db.prepare('INSERT INTO materials (id,title,category,original_name,stored_name,mime_type,size_bytes,created_at) VALUES (@id,@title,@category,@original_name,@stored_name,@mime_type,@size_bytes,@created_at)').run(row);
 res.status(201).json({ok:true,material:{...row,url:'/uploads/'+encodeURIComponent(row.stored_name)}});
}));
app.delete('/api/admin/materials/:id',adminOnly,(req,res)=>{
 const row=db.prepare('SELECT * FROM materials WHERE id=?').get(req.params.id);if(!row)return res.status(404).json({error:'फाइल नहीं मिली।'});
 db.prepare('DELETE FROM materials WHERE id=?').run(row.id);fs.unlink(path.join(uploadsDir,row.stored_name),()=>{});res.json({ok:true});
});
app.use('/uploads',express.static(uploadsDir,{index:false,dotfiles:'deny',fallthrough:false, maxAge:isProd?'1h':0}));
app.use(express.static(path.join(__dirname,'public'), { index:'index.html', etag:true, maxAge:isProd?'1h':0 }));
app.use((req,res)=>{ if(req.path.startsWith('/api/')) return res.status(404).json({error:'API route नहीं मिला।'});res.status(404).send('Page not found'); });
app.use((err,req,res,next)=>{ console.error(err); if(res.headersSent) return next(err); res.status(500).json({error:'Server पर समस्या आई। कृपया बाद में प्रयास करें।'}); });
app.listen(PORT,()=>console.log(`GKGS Quiz listening on port ${PORT} (${isProd?'production':'development'})`));

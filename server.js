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

// First-run demo quizzes are stored server-side; later edits persist in SQLite.
const seedQuizzes = [
 { id:'demo-gk', title:'भारतीय संविधान — Quick Test', subject:'GK', description:'संविधान, मौलिक अधिकार और भारतीय शासन व्यवस्था पर अभ्यास।', questions:[
  {q:'भारतीय संविधान को संविधान सभा ने कब अंगीकृत किया था?',opts:['15 अगस्त 1947','26 नवंबर 1949','26 जनवरी 1950','2 अक्टूबर 1949'],correct:1,exp:'संविधान सभा ने 26 नवंबर 1949 को भारतीय संविधान अंगीकृत किया।'},
  {q:'भारतीय संविधान में मौलिक अधिकार किस भाग में दिए गए हैं?',opts:['भाग I','भाग II','भाग III','भाग IV'],correct:2,exp:'मौलिक अधिकार संविधान के भाग III में वर्णित हैं।'},
  {q:'भारत में संसदीय शासन प्रणाली मुख्यतः किस देश से ली गई है?',opts:['अमेरिका','ब्रिटेन','कनाडा','आयरलैंड'],correct:1,exp:'संसदीय शासन प्रणाली की प्रेरणा ब्रिटेन से ली गई है।'},
  {q:'भारतीय संविधान का संरक्षक किसे कहा जाता है?',opts:['संसद','राष्ट्रपति','सर्वोच्च न्यायालय','निर्वाचन आयोग'],correct:2,exp:'सर्वोच्च न्यायालय संविधान की व्याख्या और न्यायिक समीक्षा के माध्यम से उसकी रक्षा करता है।'},
  {q:'राज्य के नीति-निदेशक तत्व संविधान के किस भाग में हैं?',opts:['भाग II','भाग III','भाग IV','भाग V'],correct:2,exp:'राज्य के नीति-निदेशक तत्व भाग IV में हैं।'}]},
 { id:'demo-science', title:'General Science — Basics', subject:'GS', description:'भौतिक विज्ञान, जीव विज्ञान और रसायन विज्ञान के मूल प्रश्न।', questions:[
  {q:'बल की SI इकाई क्या है?',opts:['जूल','न्यूटन','वाट','पास्कल'],correct:1,exp:'बल की SI इकाई न्यूटन (N) है।'},
  {q:'पौधों में प्रकाश संश्लेषण मुख्यतः किसमें होता है?',opts:['माइटोकॉन्ड्रिया','केंद्रक','क्लोरोप्लास्ट','राइबोसोम'],correct:2,exp:'क्लोरोप्लास्ट में क्लोरोफिल प्रकाश संश्लेषण में सहायता करता है।'},
  {q:'पानी का रासायनिक सूत्र क्या है?',opts:['CO₂','O₂','H₂O','NaCl'],correct:2,exp:'पानी के अणु में हाइड्रोजन के दो और ऑक्सीजन का एक परमाणु होता है।'},
  {q:'मानव शरीर में रक्त को पंप करने वाला अंग कौन-सा है?',opts:['फेफड़ा','हृदय','यकृत','गुर्दा'],correct:1,exp:'हृदय रक्त को फेफड़ों तथा शरीर के अन्य भागों तक पंप करता है।'}]},
 { id:'demo-maths', title:'Maths — Number System', subject:'Maths', description:'संख्या पद्धति और divisibility पर अभ्यास।', questions:[
  {q:'इनमें से कौन-सी संख्या अभाज्य है?',opts:['21','27','29','39'],correct:2,exp:'29 के केवल दो धनात्मक गुणनखंड 1 और 29 हैं।'},
  {q:'360 का अभाज्य गुणनखंड रूप कौन-सा है?',opts:['2³ × 3² × 5','2² × 3² × 5²','2³ × 3 × 5²','2 × 3³ × 5'],correct:0,exp:'360 = 2³ × 3² × 5।'},
  {q:'यदि कोई संख्या 3 से विभाज्य है, तो कौन-सी शर्त सही होगी?',opts:['अंतिम अंक सम हो','अंकों का योग 3 से विभाज्य हो','अंतिम दो अंक 4 से विभाज्य हों','अंतिम अंक 0 हो'],correct:1,exp:'किसी संख्या के अंकों का योग 3 से विभाज्य हो, तो संख्या भी 3 से विभाज्य होती है।'},
  {q:'सबसे छोटी अभाज्य संख्या कौन-सी है?',opts:['0','1','2','3'],correct:2,exp:'2 सबसे छोटी अभाज्य संख्या है और एकमात्र सम अभाज्य संख्या भी है।'}]}
];
if (db.prepare('SELECT COUNT(*) AS n FROM quizzes').get().n === 0) {
 const insertSeed = db.prepare('INSERT INTO quizzes (id,title,subject,description,questions_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)');
 const seedTime = now(); const tx = db.transaction(items => items.forEach(q => insertSeed.run(q.id,q.title,q.subject,q.description,JSON.stringify(q.questions),seedTime,seedTime))); tx(seedQuizzes);
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
 const rows = db.prepare('SELECT * FROM quizzes ORDER BY created_at DESC').all();
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

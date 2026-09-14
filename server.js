import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import cookieSession from 'cookie-session';
import bcrypt from 'bcryptjs';
import OpenAI from 'openai';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';

const app=express(); const PORT=Number(process.env.PORT||3000);
app.use(express.json({limit:'2mb'})); app.use(express.urlencoded({extended:true}));
app.use(cookieSession({name:'srp_session',keys:[process.env.SESSION_SECRET||'dev-only-change-me'],httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:1000*60*60*24*30}));
app.use(express.static('public'));
const users=new Map(), chats=new Map(), logs=[];
const adminEmail=process.env.ADMIN_EMAIL||'admin@example.com';
const adminHash=bcrypt.hashSync(process.env.ADMIN_PASSWORD||'change-this-admin-password',10);
const openai=process.env.OPENAI_API_KEY?new OpenAI({apiKey:process.env.OPENAI_API_KEY}):null;
const razorpay=(process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET)?new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET}):null;
const limiter=rateLimit({windowMs:60*1000,max:30,standardHeaders:true,legacyHeaders:false});
function user(req){return req.session?.userId?users.get(req.session.userId):null}
function requireUser(req,res,next){if(!user(req))return res.status(401).json({error:'Login required'});next()}
function requireAdmin(req,res,next){if(!req.session?.admin)return res.status(403).json({error:'Admin access denied'});next()}
function audit(type,req,meta={}){logs.unshift({id:uuid(),time:new Date().toISOString(),type,user:user(req)?.email||req.session?.adminEmail||'system',meta});if(logs.length>500)logs.pop()}
app.get('/api/config',(req,res)=>res.json({app:'SRP AI',model:process.env.OPENAI_MODEL||'gpt-5.6-luna',google:!!process.env.GOOGLE_CLIENT_ID,payments:!!razorpay,plans:[{id:'weekly',name:'Pro Weekly',price:100,period:'week',trial:3},{id:'monthly',name:'Pro Monthly',price:300,period:'month'},{id:'yearly',name:'Pro Yearly',price:2000,period:'year'}]}));
app.post('/api/auth/demo',limiter,(req,res)=>{const email=String(req.body.email||'').trim().toLowerCase();if(!email)return res.status(400).json({error:'Email required'});let u=[...users.values()].find(x=>x.email===email);if(!u){u={id:uuid(),email,name:email.split('@')[0],plan:'free',createdAt:new Date().toISOString(),messages:0};users.set(u.id,u)}req.session.userId=u.id;audit('login',req);res.json({user:u})});
app.post('/api/auth/logout',(req,res)=>{req.session=null;res.json({ok:true})});
app.get('/api/me',(req,res)=>res.json({user:user(req)||null,admin:!!req.session?.admin}));
app.post('/api/chat',requireUser,limiter,async(req,res)=>{const u=user(req);const {messages=[],mode='chat',web=false}=req.body;if(!Array.isArray(messages)||!messages.length)return res.status(400).json({error:'Message required'});const paid=u.plan!=='free';const paidModes=['smart','reasoning','coding','call'];if(paidModes.includes(mode)&&!paid)return res.status(402).json({error:'Pro subscription required',upgrade:true});if(!openai)return res.status(503).json({error:'AI backend is not configured. Add OPENAI_API_KEY to .env.'});
const system=`You are SRP AI, a practical premium assistant built for real work. Be accurate, direct and useful. If the user asks for code, provide complete runnable code unless they ask for an explanation only. Never pretend a feature executed when it did not. Mode: ${mode}. ${web?'Use web-search tooling when available and clearly distinguish sourced facts from general knowledge.':''}`;
try{const input=[{role:'system',content:system},...messages.slice(-30).map(m=>({role:m.role==='assistant'?'assistant':'user',content:String(m.content)}))];const tools=web?[{type:'web_search'}]:undefined;const r=await openai.responses.create({model:process.env.OPENAI_MODEL||'gpt-5.6-luna',input,tools,store:false});u.messages++;audit('ai_request',req,{mode,web});res.json({id:r.id,text:r.output_text||'No response generated.',model:r.model});}catch(e){res.status(500).json({error:e?.message||'AI request failed'})}});
app.post('/api/upgrade',requireUser,async(req,res)=>{if(!razorpay)return res.status(503).json({error:'Razorpay is not configured'});const plan=req.body.plan;const amounts={weekly:10000,monthly:30000,yearly:200000};if(!amounts[plan])return res.status(400).json({error:'Invalid plan'});try{const order=await razorpay.orders.create({amount:amounts[plan],currency:'INR',receipt:`srp_${Date.now()}`,notes:{plan,userId:user(req).id}});audit('payment_order',req,{plan,order:order.id});res.json({order,key:process.env.RAZORPAY_KEY_ID,plan})}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/payment/verify',requireUser,(req,res)=>{const {razorpay_order_id,razorpay_payment_id,razorpay_signature,plan}=req.body;const body=`${razorpay_order_id}|${razorpay_payment_id}`;const sig=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET||'').update(body).digest('hex');if(sig!==razorpay_signature)return res.status(400).json({error:'Payment verification failed'});const u=user(req);u.plan=plan;u.paidAt=new Date().toISOString();audit('payment_verified',req,{plan,razorpay_payment_id});res.json({ok:true,user:u})});
app.post('/api/admin/login',limiter,async(req,res)=>{const {email,password}=req.body;if(email!==adminEmail||!(await bcrypt.compare(String(password||''),adminHash)))return res.status(401).json({error:'Invalid admin credentials'});req.session.admin=true;req.session.adminEmail=email;audit('admin_login',req);res.json({ok:true})});
app.post('/api/admin/logout',requireAdmin,(req,res)=>{req.session=null;res.json({ok:true})});
app.get('/api/admin/overview',requireAdmin,(req,res)=>res.json({users:users.size,pro:[...users.values()].filter(u=>u.plan!=='free').length,messages:[...users.values()].reduce((a,u)=>a+u.messages,0),logs:logs.length,aiConfigured:!!openai,paymentsConfigured:!!razorpay}));
app.get('/api/admin/users',requireAdmin,(req,res)=>res.json([...users.values()].map(({id,email,name,plan,createdAt,messages})=>({id,email,name,plan,createdAt,messages}))));
app.post('/api/admin/user-plan',requireAdmin,(req,res)=>{const u=users.get(req.body.id);if(!u)return res.status(404).json({error:'User not found'});u.plan=req.body.plan==='free'?'free':'pro';audit('admin_plan_change',req,{user:u.email,plan:u.plan});res.json({ok:true})});
app.get('/api/admin/logs',requireAdmin,(req,res)=>res.json(logs.slice(0,200)));
app.post('/api/admin/clear-logs',requireAdmin,(req,res)=>{logs.length=0;res.json({ok:true})});
app.get('/api/admin/settings',requireAdmin,(req,res)=>res.json({model:process.env.OPENAI_MODEL||'gpt-5.6-luna',features:{smart:true,reasoning:true,coding:true,call:true,web:true,voice:true}}));
app.get('/api/health',(req,res)=>res.json({ok:true,time:new Date().toISOString(),ai:!!openai,payments:!!razorpay}));
app.listen(PORT,()=>console.log(`SRP AI running at http://localhost:${PORT}`));

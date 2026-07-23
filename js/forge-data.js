/* ============================================================================
   OBEYOS · ForgeData — the ONE data layer for the first-run Program Forge
   (program-forge.html · program-calibrate-final.html · program.html).

   Source order (each layer overrides the previous):
     1. DEFAULTS               — the founder-approved demo profile (mock)
     2. Supabase profiles row  — IF supabase-js is loaded AND a session exists
                                 (on GitHub Pages preview there is no session →
                                  clean fallback; on obeyos.com it just works)
     3. Demo URL overrides     — ?sex ?bf ?smm ?tier ?days ?goal persisted to
                                 localStorage so they carry across the flow

   Program lock = an ACTIVE row in custom_programs (the schema's existing
   one-active-per-user concept). No session → localStorage flag fallback
   (obeyos_program_locked), which the dash-live first-run gate reads.
   ========================================================================== */
(function(){
  'use strict';

  var SB_URL='https://scqwgaczlehugzpuhmpg.supabase.co';
  var SB_ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjcXdnYWN6bGVodWd6cHVobXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg3MTQ4NTgsImV4cCI6MjA2NDI5MDg1OH0.wLxsuGCPT8UNBLzeWTdgrTd1EqLNBhblnnrbjqZ8kOo';

  var TIER_NUM={NOISE:1,SIGNAL:2,FREQUENCY:3,AMPLITUDE:4};

  var DEFAULTS={
    sex:'male', firstName:'Athlete',
    bodyFatPct:22, smmPct:42,
    zealTier:'SIGNAL', tierNum:2,
    goal:'recomp', trainingDays:4, sessionDuration:55,
    injuryLabel:'L-knee', injuryZone:'knee',
    programName:'UPPER / LOWER',
    hrv:68, sleepH:8.1,          // wearable reads — mock until iOS sync lands
    targetBfPct:18, source:'mock'
  };

  function demoOverrides(){
    var o={};
    try{
      var q=new URLSearchParams(location.search);
      var saved=JSON.parse(localStorage.getItem('obeyos_forge_demo')||'{}');
      var take=function(k,parse){ var v=q.get(k); if(v!=null&&v!=='')saved[k]=parse?parse(v):v; };
      take('sex',function(v){return v==='female'?'female':'male';});
      take('bf',parseFloat); take('smm',parseFloat); take('days',parseInt);
      take('tier',function(v){return Math.max(1,Math.min(4,parseInt(v)||2));});
      take('goal',String); take('name',String);
      localStorage.setItem('obeyos_forge_demo',JSON.stringify(saved));
      // back-compat: standalone pages set obeyos_sex directly — honor it when no demo sex given
      if(!saved.sex){var ls=localStorage.getItem('obeyos_sex');if(ls==='female'||ls==='male')o.sex=ls;}
      if(saved.sex)o.sex=saved.sex;
      if(saved.bf)o.bodyFatPct=saved.bf;
      if(saved.smm)o.smmPct=saved.smm;
      if(saved.days)o.trainingDays=saved.days;
      if(saved.tier)o.tierNum=saved.tier;
      if(saved.goal)o.goal=saved.goal;
      if(saved.name)o.firstName=saved.name;
      // keep the standalone pages' obeyos_sex in sync (calibrate/burn read it)
      if(saved.sex)localStorage.setItem('obeyos_sex',saved.sex);
    }catch(e){}
    return o;
  }

  var _sb=null;
  function sb(){
    if(_sb)return _sb;
    if(!window.supabase||!window.supabase.createClient)return null;
    try{
      if(window.obeyosMigrateStorage)window.obeyosMigrateStorage();
      _sb=window.supabase.createClient(SB_URL,SB_ANON,{auth:{persistSession:true,storageKey:'obeyos-auth',
        storage:window.obeyosCookieStorage||window.localStorage,autoRefreshToken:true,detectSessionInUrl:true}});
      return _sb;
    }catch(e){return null;}
  }
  async function session(){
    var c=sb(); if(!c)return null;
    try{ var r=await c.auth.getSession(); return (r.data&&r.data.session)||null; }catch(e){return null;}
  }

  function injuryFromJsonb(inj){
    // profiles.injuries is a jsonb of engine categories; surface the first as a label
    try{
      var arr=Array.isArray(inj)?inj:(inj&&inj.zones)||[];
      if(!arr.length)return null;
      var z=String(arr[0]);
      var pretty=z.replace(/_/g,' ').replace(/\bleft\b/i,'L-').replace(/\bright\b/i,'R-').replace(/^l-\s*/i,'L-').trim();
      return {label:pretty.charAt(0).toUpperCase()+pretty.slice(1), zone:z};
    }catch(e){return null;}
  }

  function mapProfile(p){
    var o={source:'supabase'};
    if(p.gender==='female'||p.gender==='male')o.sex=p.gender;
    if(p.first_name)o.firstName=p.first_name;
    if(p.body_fat_pct!=null)o.bodyFatPct=+p.body_fat_pct;
    else if(p.zeal_bf_estimate!=null)o.bodyFatPct=+p.zeal_bf_estimate;
    if(p.skeletal_muscle_kg!=null&&p.weight_kg>0)o.smmPct=Math.round(p.skeletal_muscle_kg/p.weight_kg*100);
    if(p.zeal_tier&&TIER_NUM[p.zeal_tier]){o.zealTier=p.zeal_tier;o.tierNum=TIER_NUM[p.zeal_tier];}
    if(p.goal)o.goal=p.goal;
    if(p.training_days)o.trainingDays=+p.training_days;
    if(p.session_duration)o.sessionDuration=+p.session_duration;
    if(p.program)o.programName=p.program;
    var inj=injuryFromJsonb(p.injuries);
    if(inj){o.injuryLabel=inj.label;o.injuryZone=inj.zone;}else if(p.injuries!=null)o.injuryLabel=null;
    return o;
  }

  function derive(d){
    // target BF: cutting goals project −4% over the 12 weeks; others hold
    d.targetBfPct=(d.goal==='fat_loss'||d.goal==='recomp')?Math.max(8,Math.round(d.bodyFatPct-4)):Math.round(d.bodyFatPct);
    // grid-clean figure states (5 fat × 3 muscle) — onboarding mapping
    var f=function(bf){return bf<15?0:bf<21?1:bf<27?2:bf<33?3:4;};
    var m=function(s){return s<38?0:s<46?1:2;};
    var fNow=f(d.bodyFatPct), mNow=m(d.smmPct);
    var fTgt=fNow, mTgt=mNow;
    if(d.goal==='fat_loss'){fTgt=Math.max(0,fNow-1);}
    else if(d.goal==='recomp'){fTgt=Math.max(0,fNow-1);mTgt=Math.min(2,mNow+1);}
    else {mTgt=Math.min(2,mNow+1);}                       // lean_bulk / performance
    d.figNow='obeyos-model-'+d.sex+'-f'+fNow+'m'+mNow+'.webp';
    d.figTarget='obeyos-model-'+d.sex+'-f'+fTgt+'m'+mTgt+'.webp';
    d.glb='obeyos-model-'+d.sex+'-3d.glb';
    return d;
  }

  async function load(){
    var d=Object.assign({},DEFAULTS);
    var s=await session();
    if(s){
      try{
        var r=await sb().from('profiles').select('*').eq('id',s.user.id).maybeSingle();
        if(r.data)Object.assign(d,mapProfile(r.data));
      }catch(e){}
    }
    Object.assign(d,demoOverrides());
    try{localStorage.setItem('obeyos_sex',d.sex);}catch(e){}
    return derive(d);
  }

  async function hasLockedProgram(){
    var s=await session();
    if(s){
      try{
        var r=await sb().from('custom_programs').select('id').eq('user_id',s.user.id).eq('is_active',true).limit(1);
        if(r.data&&r.data.length){try{localStorage.setItem('obeyos_program_locked','1');}catch(e){} return true;}
        return false;
      }catch(e){}
    }
    try{return !!localStorage.getItem('obeyos_program_locked');}catch(e){return false;}
  }

  async function lockProgram(d){
    d=d||DEFAULTS;
    var s=await session();
    if(s){
      try{
        // one active program per user (unique partial index) — deactivate, then insert
        await sb().from('custom_programs').update({is_active:false}).eq('user_id',s.user.id).eq('is_active',true);
        await sb().from('custom_programs').insert({user_id:s.user.id,name:d.programName,
          days_per_week:d.trainingDays,split_type:'upper_lower',goal:d.goal,source:'library',is_active:true});
      }catch(e){}
    }
    try{localStorage.setItem('obeyos_program_locked','1');}catch(e){}
  }

  window.ForgeData={load:load,hasLockedProgram:hasLockedProgram,lockProgram:lockProgram,
    DEFAULTS:derive(Object.assign({},DEFAULTS))};   // pre-derived → safe for instant first paint
})();

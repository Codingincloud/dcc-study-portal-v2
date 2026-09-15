/* ../custom-theme.js */
/* The one reading mode that is not precomputed: the reader's own.

   The other eight modes are finished palettes. This file derives a ninth from
   two colours the reader picks - an accent and a surface - and it has to produce
   the SAME 39-token contract the hand-written modes declare, because the
   stylesheet cannot tell the difference: every rule in foundation.css reads
   var(--pri-bg), var(--t2), var(--brd) and never a literal.

   THE HARD PART IS NOT THE COLOURS, IT IS THE GUARANTEE. A reader can pick
   white-on-white, or a saturated mid-grey, or the exact hue of the "success"
   callout for their accent. All of those are valid inputs and none of them may
   produce an unreadable page. So nothing here is a lookup or a fixed offset:
   every colour that carries meaning is SOLVED - walked along its own hue until
   it clears the contrast it has to clear, with a margin - and the walk always
   terminates on a value that cannot fail (pure black for ink on paper, pure
   white for ink on ink).

   Two rules hold the meaning of the notes together while the palette changes:

     1. The reader's accent drives the BRAND layer (--pri*), all seven surfaces,
        all three inks, the rules, the table head and the shadows. That is most
        of what a reader recognises as "their" theme.
     2. The four SEMANTIC roles do not move: green is still success, ochre still
        caution, brick still danger, plum still "commonly asked". Only their
        lightness is solved, so they sit correctly on the reader's surface. If a
        reader's accent lands on one of those hues it is nudged off it, because
        a green brand accent beside a green success callout reads as two
        successes.

   The output is the token set WITH the leading `--` stripped, keyed the way
   tools/check_themes.py parses it, plus `kind` (light or dark, decided by the
   surface) and `meta` (the browser chrome colour, which is --bg).

   Loaded as a plain script in <head> - before the boot script, because the
   reader's stored custom palette has to be on <html> before the first style
   resolution, exactly like the stored mode id. Also loadable in node via
   `vm` for tools/test_custom_theme.js, which is what proves the guarantee over
   a grid of awkward inputs rather than the three a human would try by hand. */
(function(){
'use strict';

/* ---------------------------------------------------------------- maths ---- */

function hex2rgb(hex){
  var h=String(hex||'').trim().replace(/^#/,'');
  if(h.length===3)h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  if(!/^[0-9a-fA-F]{6}$/.test(h))return null;
  return {r:parseInt(h.slice(0,2),16),g:parseInt(h.slice(2,4),16),b:parseInt(h.slice(4,6),16)};
}
function rgb2hex(c){
  var f=function(v){v=Math.max(0,Math.min(255,Math.round(v)));return (v<16?'0':'')+v.toString(16);};
  return '#'+f(c.r)+f(c.g)+f(c.b);
}
/* rgb with alpha, for the two shadows and the dark stripe - the same shapes the
   hand-written modes use, so a derived mode is not a special case in the CSS. */
function rgba(c,a){
  var f=function(v){return Math.max(0,Math.min(255,Math.round(v)));};
  return 'rgba('+f(c.r)+', '+f(c.g)+', '+f(c.b)+', '+a+')';
}
function rgb2hsl(c){
  var r=c.r/255,g=c.g/255,b=c.b/255;
  var max=Math.max(r,g,b),min=Math.min(r,g,b);
  var l=(max+min)/2,h=0,s=0;
  if(max!==min){
    var d=max-min;
    s=l>0.5?d/(2-max-min):d/(max+min);
    if(max===r)h=((g-b)/d+(g<b?6:0));
    else if(max===g)h=(b-r)/d+2;
    else h=(r-g)/d+4;
    h*=60;
  }
  return {h:h,s:s,l:l};
}
function hsl2rgb(o){
  var h=((o.h%360)+360)%360/360,s=Math.max(0,Math.min(1,o.s)),l=Math.max(0,Math.min(1,o.l));
  function hue(p,q,t){
    if(t<0)t+=1;if(t>1)t-=1;
    if(t<1/6)return p+(q-p)*6*t;
    if(t<1/2)return q;
    if(t<2/3)return p+(q-p)*(2/3-t)*6;
    return p;
  }
  if(s===0)return {r:l*255,g:l*255,b:l*255};
  var q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q;
  return {r:hue(p,q,h+1/3)*255,g:hue(p,q,h)*255,b:hue(p,q,h-1/3)*255};
}
/* W3C relative luminance, the same numbers tools/check_themes.py computes, so a
   palette this file accepts cannot then fail the gate. */
function lum(hex){
  var c=hex2rgb(hex);
  if(!c)return null;
  var f=function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
  return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);
}
function ratio(a,b){
  var la=lum(a),lb=lum(b);
  if(la===null||lb===null)return null;
  var hi=Math.max(la,lb),lo=Math.min(la,lb);
  return (hi+0.05)/(lo+0.05);
}
/* Compound a colour at alpha over a surface - the hairline and stripe tokens are
   rgba in the dark modes, and a contrast check has to see the painted colour. */
function over(fg,alpha,bgHex){
  var f=hex2rgb(fg),b=hex2rgb(bgHex);
  return rgb2hex({r:f.r*alpha+b.r*(1-alpha),g:f.g*alpha+b.g*(1-alpha),b:f.b*alpha+b.b*(1-alpha)});
}
function mix(aHex,bHex,t){
  var a=hex2rgb(aHex),b=hex2rgb(bHex);
  return rgb2hex({r:a.r+(b.r-a.r)*t,g:a.g+(b.g-a.g)*t,b:a.b+(b.b-a.b)*t});
}
function at(h,s,l){ return rgb2hex(hsl2rgb({h:h,s:s,l:l})); }
function clamp(v,lo,hi){ return v<lo?lo:(v>hi?hi:v); }
/* Saturation with a floor - EXCEPT at exactly zero, which is not "almost none",
   it is "this colour has no hue". Flooring a zero up is how a grey accent became
   a muted rose: the hue of a neutral is reported as 0, and 0 is red. */
function sat(s,floor){ return s<=0?0:clamp(s,floor,0.95); }
/* The distance between two hues in degrees, the short way round. */
function hueGap(a,b){ var d=Math.abs(a-b)%360; return d>180?360-d:d; }

/* THE SOLVER. Walk lightness in small steps from `from` toward `to` and stop at
   the first value that satisfies `test`. `to` is always chosen so that it cannot
   fail - pure black for dark ink, pure white for light ink, pure black for a
   fill that carries white text - so a reader cannot hand this a surface that
   has no answer. The fallback at the end is therefore unreachable, and exists so
   the function is total rather than so it is used.

   0.004 is roughly the smallest lightness step that is visible in an sRGB
   palette; anything finer spends time to produce the same hex. */
function solve(h,s,from,to,test){
  var dir=to>from?1:-1, l=from, guard=0;
  while(guard++<600){
    var hex=at(h,s,l);
    if(test(hex))return hex;
    if(dir>0?l>=to:l<=to)break;
    l=clamp(l+dir*0.004,0,1);
  }
  return at(h,s,to);
}

/* ------------------------------------------------------- the reader's two ---- */

var DEFAULT_ACCENT='#4f5bd5';
var DEFAULT_SURFACE='#f6f5f2';

/* The four semantic roles, and the brand. Hue is the meaning and the reader
   cannot move it; saturation is a starting point the solver may darken. */
var ROLES=[
  {key:'pri',hue:null,sat:0.62},
  {key:'sec',hue:148,sat:0.34},
  {key:'acc',hue:38, sat:0.62},
  {key:'dan',hue:6,  sat:0.54},
  {key:'vio',hue:288,sat:0.30}
];
/* THE ACCENT IS THE READER'S, AND THAT IS A PROMISE.

   A first version of this file rotated the brand hue clear of any semantic hue
   it came within 30 degrees of, and it was wrong in the way that matters most:
   a reader who picked crimson #c2185b - 336 degrees, about 30 from the danger
   brick - watched their accent come out BLUE, because the search looked for a
   fully free hue and found one 90 degrees away. The feature appeared broken.

   So the rule is now the narrowest one that still holds the contract together:
   two roles may not be the SAME colour, and nothing else is touched. Under 10
   degrees apart is not "a similar colour", it is the same colour twice, which is
   what makes a brand green indistinguishable from a success green; at 14 degrees
   of nudge they are still plainly the same family and no longer equal. Anything
   further apart than 10 is left exactly as the reader set it, and
   tools/test_custom_theme.js asserts that hue preservation directly. */
var SEMANTIC_TOLERANCE=10, SEMANTIC_NUDGE=14;

/* Surfaces, as offsets in HSL lightness from the page. Signed the same way in
   both kinds - positive is lighter - so the table reads as one ladder. "Cards
   are lighter than the page, the sidebar is darker" is true in both a paper
   theme and a lamp theme; only the base moves. */
var LIGHT_LADDER={ 'bg-card':0.055,'bg-side':-0.045,'bg-side-h':-0.085,
                   'bg-side-a':-0.130,'bg-input':-0.040,'bg-code':-0.028,
                   'stripe':0.020,'th-bg':-0.045 };
var DARK_LADDER ={ 'bg-card':0.036,'bg-side':-0.028,'bg-side-h':-0.010,
                   'bg-side-a':0.030,'bg-input':0.030,'bg-code':0.022,
                   'stripe':-0.014,'th-bg':0.036 };

/* The page is clamped into a band per kind. Not to overrule the reader: a page
   at L 0.55 is neither a paper theme nor a lamp theme, and the ladder, the inks
   and the tints all need one or the other. The HUE and most of the SATURATION
   survive, which is what a reader is actually choosing. */
var LIGHT_PAGE=[0.90,0.97], LIGHT_SAT=0.34;
var DARK_PAGE =[0.020,0.070], DARK_SAT=0.42;

function derive(accentHex,surfaceHex){
  var accent=hex2rgb(accentHex)||hex2rgb(DEFAULT_ACCENT);
  var surface=hex2rgb(surfaceHex)||hex2rgb(DEFAULT_SURFACE);

  /* 1. the kind, from the surface the reader picked ---------------------- */
  var kind=lum(rgb2hex(surface))>=0.20?'light':'dark';
  var light=kind==='light';

  /* 2. the page, and the ladder of surfaces around it -------------------- */
  var sHSL=rgb2hsl(surface);
  var band=light?LIGHT_PAGE:DARK_PAGE;
  var pageL=clamp(sHSL.l,band[0],band[1]);
  var pageS=clamp(sHSL.s,0,light?LIGHT_SAT:DARK_SAT);
  var pageH=sHSL.h;
  var t={};
  t.bg=at(pageH,pageS,pageL);

  var ladder=light?LIGHT_LADDER:DARK_LADDER;
  Object.keys(ladder).forEach(function(name){
    /* Cards sit further from the page than the rest, and lose saturation: a
       tinted card on a tinted page reads as a print error, not as a card. */
    var satScale=name==='bg-card'?0.5:1;
    /* The dark stripes are translucent white, matching all four hand-written
       dark modes - a solid grey stripe on a dark page looks like a seam. */
    if(name==='stripe'&&!light){ t.stripe=rgba({r:255,g:255,b:255},0.022); return; }
    t[name]=at(pageH,pageS*satScale,clamp(pageL+ladder[name],0,1));
  });
  /* 3. the five roles: fill, tint, border -------------------------------- */
  var accentHSL=rgb2hsl(accent);
  /* A GREY ACCENT IS NOT A RED ONE. rgb2hsl gives a neutral colour hue 0, and
     hue 0 is red - so clamping the saturation up from 0 turned #828282 into a
     muted rose the reader never asked for. Below this chroma the brand layer is
     kept neutral instead: the chrome goes grey, and the four semantic roles keep
     their own hues, so the page reads as a neutral theme with coloured callouts
     rather than as somebody else's palette. */
  var NEUTRAL=0.06;
  var priHue=accentHSL.h, priSat=accentHSL.s<NEUTRAL?0:sat(accentHSL.s,0.15);
  ROLES.forEach(function(role){
    if(role.key==='pri'){ role._h=priHue; role._s=priSat; }
    else{ role._h=role.hue; role._s=role.sat; }
  });
  /* Break a tie with a semantic role, and only a tie: see SEMANTIC_TOLERANCE.
     Both directions are scored and the roomier one wins, so a brand hue that is
     sitting on the success green moves away from it rather than into the
     caution ochre. */
  var semantic=ROLES.filter(function(r){ return r.key!=='pri'; });
  var roomiest=function(h){ return Math.min.apply(null,semantic.map(function(r){ return hueGap(h,r._h); })); };
  if(priSat>0&&roomiest(priHue)<SEMANTIC_TOLERANCE){
    var dirs=[priHue+SEMANTIC_NUDGE,priHue-SEMANTIC_NUDGE].map(function(c){
      return ((c%360)+360)%360;
    });
    dirs.sort(function(a,b){ return roomiest(b)-roomiest(a); });
    ROLES[0]._h=dirs[0];
  }

  var tintL=light?clamp(pageL-0.055,0.74,0.97):clamp(pageL+0.050,0.03,0.20);
  var bdL  =light?clamp(pageL-0.090,0.66,0.94):clamp(pageL+0.085,0.05,0.26);
  /* Every surface an ink or a label can land on, collected as we build them, so
     the solver below tests against what the stylesheet will actually paint
     instead of against a hand-copied list that can drift. */
  var inkSurfaces=['bg','bg-card','bg-side'];
  var labelTests;

  ROLES.forEach(function(role){
    var h=role._h, s=role._s;
    /* The tint is the same hue, pulled toward the page: it has to read as a
       tinted band, not as a second card. */
    var tintSat=s<=0?0:(light?clamp(s*0.55,0.10,0.40):clamp(s*0.50,0.12,0.42));
    t[role.key+'-bg']=at(h,tintSat,tintL);
    t[role.key+'-bd']=at(h,s<=0?0:clamp(s*0.6,0.10,0.45),bdL);
    inkSurfaces.push(role.key+'-bg');
    /* The FILL carries hardcoded white text - quiz option letters, the +10 XP
       chip, "Mark done". Solved, never offset: the ochre role is the one that
       fails this by eye, and it failed for real in Lamp at 3.24:1.

       THE WALK STARTS AT THE COLOUR THE READER PICKED, not at a fixed lightness.
       Starting low and walking down would darken every accent to the same navy-
       ish fill and throw away the thing they chose; starting at the accent's own
       lightness and darkening only as far as white text requires keeps a vivid
       accent vivid, and still lands a pale one (yellow, lime) deep enough to
       carry white. The four semantic roles have no such colour to preserve, so
       they start where the hand-written modes sit: 0.40 on paper, 0.34 on ink. */
    /* The saturation floor is low on purpose: a reader who picks a near-grey
       accent wants a near-grey accent, and 0.30 turned #808080 into a colour
       they did not choose. 0.15 keeps white-on-fill solvable without inventing
       chroma that was not there. */
    var fillFrom=role.key==='pri'?clamp(accentHSL.l,0.30,0.62):(light?0.40:0.34);
    t[role.key]=solve(h,sat(s,0.15),fillFrom,0,function(hex){
      return ratio('#ffffff',hex)>=4.75;
    });
    role._hue=h;
  });

  /* 4. the inks, solved against EVERY surface they can land on ------------ */
  var dir=light?-1:1;                      /* light mode darkens, dark lightens */
  var from=light?0.42:0.62, to=light?0:1;
  function inkTargets(min){
    return function(hex){
      for(var i=0;i<inkSurfaces.length;i++){
        var r=ratio(hex,t[inkSurfaces[i]]);
        if(r===null||r<min)return false;
      }
      return true;
    };
  }
  /* Three inks, three jobs, three margins. 11 and 8 rather than 4.5 because
     these are the values a reader spends the most time in, and headroom is what
     keeps a 15px footnote from being the thing AT the limit. */
  t.t1=solve(pageH,clamp(pageS,0,0.30),from,to,inkTargets(11));
  t.t2=solve(pageH,clamp(pageS,0,0.30),light?0.60:0.74,to,inkTargets(8));
  t.t3=solve(pageH,clamp(pageS,0,0.24),light?0.78:0.86,to,inkTargets(4.8));

  /* 5. the accent label, solved against the page, a card AND its own tint --- */
  ROLES.forEach(function(role){
    var h=role._hue,s=role._s;
    t[role.key+'-l']=solve(h,sat(s,0.18),light?0.50:0.60,to,function(hex){
      return ratio(hex,t.bg)>=4.7&&ratio(hex,t['bg-card'])>=4.7
          &&ratio(hex,t[role.key+'-bg'])>=4.7;
    });
  });
  /* The formula box is --pri-l on --bg-code, and bg-code is a ladder surface the
     pri-l walk above did not know about. One extra pass, on the same hue. */
  t['pri-l']=solve(ROLES[0]._hue,sat(ROLES[0]._s,0.18),light?0.50:0.60,to,function(hex){
    return ratio(hex,t.bg)>=4.7&&ratio(hex,t['bg-card'])>=4.7
        &&ratio(hex,t['pri-bg'])>=4.7&&ratio(hex,t['bg-code'])>=4.7;
  });

  /* 6. structure: rules, the figure stroke, the table head --------------- */
  /* A hairline only has to be visible as a line - 1.15:1 for the card border,
     1.05:1 for the rule inside a table - and a fixed offset looks right on
     paper and vanishes on ink: a 0.05 lightness step near L 0.02 is a ratio of
     1.04, which is why the first version of this file failed on every dark
     surface in the grid. Solved instead, walking away from the page only as far
     as the ratio requires, so the rule stays a hairline on a light theme and
     becomes a visible one on a dark theme - which is what the four hand-written
     dark modes do too. */
  function structure(min,surfaces){
    return function(hex){
      for(var i=0;i<surfaces.length;i++){
        var r=ratio(hex,t[surfaces[i]]);
        if(r===null||r<min)return false;
      }
      return true;
    };
  }
  t.brd=solve(pageH,clamp(pageS,0,0.30),clamp(pageL+(light?-0.050:0.050),0,1),to,
              structure(1.22,['bg','bg-card','bg-side']));
  t['brd-l']=solve(pageH,clamp(pageS,0,0.24),clamp(pageL+(light?-0.020:0.020),0,1),to,
                   structure(1.09,['bg-card']));
  /* fig-line is CONTENT, not decoration - WCAG 1.4.11 wants 3:1 - so it is
     solved rather than offset, and solved against both surfaces it is drawn on. */
  t['fig-line']=solve(pageH,0.06,light?0.55:0.55,light?0:1,function(hex){
    var a=ratio(hex,t['bg-card']),b=ratio(hex,t.bg);
    return a!==null&&b!==null&&a>=3.2&&b>=3.2;
  });
  t['th-c']=solve(pageH,clamp(pageS,0,0.24),light?0.40:0.70,to,function(hex){
    return ratio(hex,t['th-bg'])>=5;
  });

  /* 7. elevation and grain ---------------------------------------------- */
  /* Shadows are tinted with the page's own hue, never flat black: a neutral
     shadow under a warm page reads as dirt. */
  var shadowHue=hex2rgb(t.t1);
  t.sh   ='0 1px 2px '+rgba(shadowHue,light?0.06:0.16);
  t['sh-md']='0 12px 32px '+rgba(shadowHue,light?0.12:0.30);
  t.grain=light?0.022:0.010;

  t.kind=kind;
  t.meta=t.bg;
  /* The five swatches the picker shows on this tile - the derived palette's own
     colours, so the tile reads the way the hand-written ones do. */
  t.strip=[t.bg,t['bg-side'],t['pri-bg'],t.pri,t.t1];
  return t;
}

/* The token names the stylesheet requires, in the order tokens.css declares
   them. tools/test_custom_theme.js fails if `derive` ever returns fewer. */
var TOKENS=['bg','bg-card','bg-side','bg-side-h','bg-side-a','bg-input','bg-code',
  'pri','pri-l','pri-bg','pri-bd','sec','sec-l','sec-bg','sec-bd',
  'acc','acc-l','acc-bg','acc-bd','dan','dan-l','dan-bg','dan-bd',
  'vio','vio-l','vio-bg','vio-bd','t1','t2','t3','brd','brd-l','fig-line',
  'sh','sh-md','th-bg','th-c','stripe','grain'];

/* Where the custom palette is remembered. Kept here rather than in app.js so the
   boot script and the picker cannot disagree about the key.

   The namespace is read from window.COURSE **at call time, not at load time**.
   That matters: this file is bundled after the course file, but the bundle is one
   parse unit and the browser hoists nothing of the sort we need, so reading it
   once at module scope would be reading it at a moment a reorder could change.
   Reading it per call costs nothing and cannot be got wrong.

   It has to match the literal in each entry page's boot script, which cannot see
   window.COURSE - that script runs in <head>, before any course file. So the two
   are tied together by tools/test_custom_theme.js, which reads the id out of
   dcc-site/course.js and the key out of the boot script and fails if they
   disagree. */
function ns(){ return (typeof window!=='undefined'&&window.COURSE&&window.COURSE.id)||'sm'; }
function keyOf(what){ return ns()+'-'+what; }
var STORE_ACCENT='accent', STORE_SURFACE='surface', STORE_CACHE='custom-palette';

/* WHY THE PALETTE IS CACHED, AND NOT JUST THE TWO COLOURS.

   The boot script in each entry page runs during parse, in <head>, and it has to
   have the reader's palette on <html> before the first style resolution - that is
   the whole reason it exists rather than living in app.js (see the long note
   there). But this file is BUNDLED: build_deploy folds every <script src> into a
   deferred site.js, so at boot time `window.CustomTheme` does not exist yet and
   the derivation cannot be run.

   So the derivation runs once, when the reader picks, and the RESULT is stored:
   a flat list of [property, value] pairs that the boot script can apply with a
   three-line loop and no knowledge of how it was computed. Anything else - a
   dark palette derived on a light seed, say - would flash the seed palette on
   every single page load.

   The cache is validated on read: the version, and both colours, have to still
   match what is stored, and every token has to be present. A cache that fails
   any of those is ignored rather than trusted, and the reader gets the seed
   palette from tokens.css - which is valid by construction, and which
   tools/test_custom_theme.js proves is a palette derive() would itself produce.
   Bump VERSION whenever `derive` changes what it returns. */
var VERSION=1;

/* Put a derived palette on <html> as INLINE custom properties. Inline beats
   every selector, so these win over [data-theme="custom"] in tokens.css - which
   is exactly the point: that block is the fallback for a reader who has never
   opened the picker, and this is the reader's own. */
function apply(t,el){
  el=el||document.documentElement;
  TOKENS.forEach(function(name){ el.style.setProperty('--'+name,t[name]); });
  el.style.setProperty('--stripe',t.stripe);
  return t;
}
/* And take them off again. Without this, switching from Custom to Lamp leaves
   the derived surfaces inline on <html>, where no stylesheet can override them
   and every other mode renders in the reader's old palette. */
function clear(el){
  el=el||document.documentElement;
  TOKENS.forEach(function(name){ el.style.removeProperty('--'+name); });
  return el;
}
function stored(){
  try{
    return {accent:localStorage.getItem(keyOf(STORE_ACCENT))||DEFAULT_ACCENT,
            surface:localStorage.getItem(keyOf(STORE_SURFACE))||DEFAULT_SURFACE};
  }catch(e){ return {accent:DEFAULT_ACCENT,surface:DEFAULT_SURFACE}; }
}
function remember(accent,surface,palette){
  try{
    localStorage.setItem(keyOf(STORE_ACCENT),accent);
    localStorage.setItem(keyOf(STORE_SURFACE),surface);
    if(palette)localStorage.setItem(keyOf(STORE_CACHE),JSON.stringify(pack(palette,accent,surface)));
  }catch(e){}
}
/* The cache record: what it is, what it was made from, and the list of
   properties the boot script paints. */
function pack(t,accent,surface){
  var out=t.kind+'|'+(t.bg||'');
  return {v:VERSION,a:accent,s:surface,kind:t.kind,bg:t.bg,strip:t.strip,
          pairs:TOKENS.map(function(n){ return ['--'+n,t[n]]; })};
}
/* Read it back, or null. Never throws and never returns a partial palette: the
   boot script has no way to report a problem, so the only honest answer to
   "something is off" is the fallback block. */
function cached(){
  try{
    var c=JSON.parse(localStorage.getItem(keyOf(STORE_CACHE))||'null');
    if(!c||c.v!==VERSION||!c.pairs||c.pairs.length!==TOKENS.length)return null;
    if(c.a!==(localStorage.getItem(keyOf(STORE_ACCENT))||DEFAULT_ACCENT))return null;
    if(c.s!==(localStorage.getItem(keyOf(STORE_SURFACE))||DEFAULT_SURFACE))return null;
    for(var i=0;i<c.pairs.length;i++)if(!c.pairs[i][1])return null;
    return c;
  }catch(e){ return null; }
}
/* What a *reader* asked for, as opposed to what the cache happens to hold: the
   two colours, their palette, and the cache record. */
function current(){
  var s=stored(), t=derive(s.accent,s.surface);
  return {accent:s.accent,surface:s.surface,palette:t,record:pack(t,s.accent,s.surface)};
}

/* ------------------------------------------------------- the link codec ----

   The appearance has two halves that are stored per device: the mode id, the
   width, and - for Custom - the reader's two colours. There is no account and
   no server to sync them through, and a static site has no other place to put
   them, so the transport is the URL: three short parameters, `t`, `w` and `c`.

     ?t=custom&w=full&c=4f5bd5,f6f5f2      - the reader's own palette
     ?t=eveningmix&w=comfort               - one of the eight

   What that buys, exactly: `Sync` in the picker copies a link, the reader opens
   it once on the other device, and the appearance is applied there and then
   PERSISTED locally - so the link is a courier, not a live connection. Both
   devices agree from then on because each remembers what it was told, and each
   stays free to diverge without dragging the other with it. A real two-way sync
   needs a backend, and this site deliberately has none.

   THIS IS THE ONLY COPY OF THE FORMAT. app.js builds the link from here, and the
   boot script in each entry page - which cannot see this file, because it runs
   during parse and this is bundled into a deferred site.js - parses it with a
   small inline copy. tools/test_custom_theme.js reads both boot scripts and
   fails if the three parameter names in them drift from PARAMS here, because a
   typo in that copy would be silent: the page would simply keep the mode it
   already had. */
var PARAMS={theme:'t',width:'w',colours:'c'};

/* Read the appearance out of a `location.search`. Never throws, never returns a
   half-applied state: anything that does not parse cleanly comes back null and
   the device keeps what it had. Colours are normalised through hex2rgb/rgb2hex,
   so `#AB12CD`, `ab12cd` and `#ABC` all land on the same value and a link that
   has been through a chat app's URL mangling still works. */
function readLink(search){
  var out={theme:null,width:null,accent:null,surface:null};
  var q=String(search||'').replace(/^\?/,'');
  if(!q)return out;
  var seen={};
  q.split('&').forEach(function(pair){
    if(!pair)return;
    var i=pair.indexOf('=');
    try{
      var k=decodeURIComponent(i<0?pair:pair.slice(0,i));
      seen[k]=decodeURIComponent(i<0?'':pair.slice(i+1));
    }catch(e){}
  });
  if(seen[PARAMS.width]==='full'||seen[PARAMS.width]==='comfort')out.width=seen[PARAMS.width];
  if(seen[PARAMS.theme])out.theme=seen[PARAMS.theme];
  var c=String(seen[PARAMS.colours]||'').split(',');
  if(c.length===2){
    var a=hex2rgb(c[0]),s=hex2rgb(c[1]);
    if(a&&s){ out.accent=rgb2hex(a); out.surface=rgb2hex(s); }
  }
  /* Two colours with no mode named can only mean Custom. Without this the link
     would carry a palette that nothing had been told to display - the mode would
     stay Lamp and the colours would sit in storage, unused. */
  if(out.accent&&!out.theme)out.theme='custom';
  return out;
}

/* The query string for an appearance. `theme`/`width` are passed through
   unprefixed rather than validated against a list of ids, because the list of
   ids lives in app.js and in the boot scripts and this file may not guess: a
   caller that names a mode the stylesheet does not have is a bug the tests
   catch, and silently dropping it here would hide it. Colours are only carried
   for Custom - the eight shipped modes do not have any. */
function link(o){
  o=o||{};
  var parts=[];
  if(o.theme)parts.push(PARAMS.theme+'='+encodeURIComponent(o.theme));
  if(o.width)parts.push(PARAMS.width+'='+encodeURIComponent(o.width));
  var a=hex2rgb(o.accent),s=hex2rgb(o.surface);
  if(o.theme==='custom'&&a&&s)
    parts.push(PARAMS.colours+'='+rgb2hex(a).slice(1)+','+rgb2hex(s).slice(1));
  return parts.length?'?'+parts.join('&'):'';
}

window.CustomTheme={derive:derive,apply:apply,clear:clear,stored:stored,cached:cached,
  current:current,remember:remember,pack:pack,ns:ns,keyOf:keyOf,TOKENS:TOKENS,VERSION:VERSION,
  PARAMS:PARAMS,readLink:readLink,link:link,
  /* The tie-break rule, exported so the test asserts the real numbers rather
     than a copy of them. */
  TOLERANCE:SEMANTIC_TOLERANCE,NUDGE:SEMANTIC_NUDGE,
  DEFAULT_ACCENT:DEFAULT_ACCENT,DEFAULT_SURFACE:DEFAULT_SURFACE,
  /* The palette a reader gets before they have chosen anything. tokens.css
     declares it as [data-theme="custom"], and test_custom_theme.js asserts the
     two agree - so the fallback can never be a palette this file would not
     itself produce. */
  seed:function(){ return derive(DEFAULT_ACCENT,DEFAULT_SURFACE); }};
})();

;
/* course.js */
/* What course this is.

   The shell — engine.js, app.js, modules/*, assets/css/* — is shared with the
   Simulation & Modeling portal and reads everything that differs between the
   two courses from here. It has to be defined before engine.js runs, which is
   why this file is the first script on the page.

   Every number below is from the syllabus PDF, not from memory:

     `m`      the "Tentative Marks Distribution" table on page 3, which the
              marks add up to 60 in
     `h`      the hours in brackets after each unit heading, which add to 45
              scheduled hours (L 3 / T 1 / P 2 per week)
     `tabs`   the mock exam is deliberately absent: this course is one paper
              old, so there is no bank to build a weighted 60-mark paper from
              yet. `engine.js` refuses #/exam when 'exam' is not in this list
              rather than routing to a panel that does not exist. */

window.COURSE = {
  id: 'dcc',
  code: 'BCE7024',
  title: 'Distributed & Cloud Computing',
  semester: 'Sem VII',

  /* Chapter marks, in chapter order. The sum is the paper total — engine.js
     adds them rather than taking a separate literal, so the header, the score
     and the breakdown cannot drift apart. */
  examWeights: [6, 10, 6, 6, 6, 8, 6, 8, 4],
  chapterCount: 9,
  tabs: ['learn', 'quiz', 'past', 'analysis'],

  /* `t` is what the sidebar and the breadcrumb show, so it is kept short
     enough to sit on one line in a 240px rail. `m` is the marks badge. */
  meta: [
    { n: 1, t: 'Introduction to Distributed Systems', m: 6,  h: 4 },
    { n: 2, t: 'Communication in Distributed Systems', m: 10, h: 7 },
    { n: 3, t: 'Synchronization and Coordination',    m: 6,  h: 5 },
    { n: 4, t: 'Distributed File Systems',            m: 6,  h: 5 },
    { n: 5, t: 'Introduction to Cloud Computing',     m: 6,  h: 4 },
    { n: 6, t: 'Virtualization and Cloud Architecture', m: 8, h: 6 },
    { n: 7, t: 'Cloud Platforms and Technologies',    m: 6,  h: 4 },
    { n: 8, t: 'Security and Challenges in Cloud',    m: 8,  h: 6 },
    { n: 9, t: 'Emerging Trends',                    m: 4,  h: 4 }
  ]
};

;
/* ch1.js */
/* Chapter 1 — Introduction to Distributed Systems.

   Syllabus unit 1: 4 hours, 6 marks. Sub-topics 1.1 Definition and
   characteristics, 1.2 Goals of distributed systems, 1.3 Examples: Google File
   System, Hadoop, BitTorrent, etc., 1.4 Models: Client-server, Peer-to-peer,
   Multitier.

   Everything here is written from the course's own material, which is read
   into `_source/dcc/` by tools/dcc_extract.py:

     lecture_notes_all_chapterwise_chapter1_int_to_distbd_sys.txt
         Er. Avijit Karn's 26-slide Chapter 1 deck (1.1-1.9)

     gfs_hdfs_lecture.txt, hdfs_note_4std_lecture.txt
         the GFS/HDFS lectures, which are what sub-topic 1.3 names

     syllabus_distbd_cloudcomptng.txt
         the unit list, the hours, the marks table and the Model Question 2025

   Where a fact comes from a recommended textbook rather than the deck it says
   so in the text, because the deck is 26 slides and the syllabus expects the
   books to be read alongside it. */

window.CHAPTERS = window.CHAPTERS || {};
window.CHAPTERS[1] = {
  learn: `

<h2>Unit 1 &mdash; Introduction to Distributed Systems</h2>
<p class="unit-meta">Syllabus: 4 hours &middot; 6 marks &middot; sub-topics 1.1&ndash;1.4</p>

<div class="concept-box asked">
<h4>What this unit is worth in the exam</h4>
<ul>
<li><strong>2 marks</strong> &mdash; &ldquo;Define a distributed system.&rdquo; This was <em>question 1</em> of Group A in the Model Question 2025, so it is the first thing on the paper.</li>
<li><strong>4 marks</strong> &mdash; &ldquo;Explain the goals of distributed systems.&rdquo; (Group B, Model 2025)</li>
<li><strong>4 marks</strong> &mdash; &ldquo;Differentiate between client-server and peer-to-peer architectures with examples.&rdquo; (Group B, Model 2025)</li>
</ul>
<p>Three of the paper's sixteen questions come from this unit, and it is only four teaching hours long &mdash; the best marks-per-hour in the course. The six-mark weight in the syllabus table is confirmed by the paper itself.</p>
</div>

<p>Read the unit in the order the deck teaches it, because each section feeds the one after: 1.1 gives the definition the paper opens with, 1.2 the goals, 1.3 the examples and 1.4 the models the rest of the course is built on. The deck's closing material sits inside those four sections rather than beside them: advantages and disadvantages are 1.1.3, the four problems are 1.2.1, resource sharing is 1.2.2, the Web is 1.3.1, and the types of system are 1.4.5. That folded material is where the second half of a multi-part question usually comes from.</p>

<h2>1.1 Definition and Characteristics</h2>

<div class="concept-box">
<h4>Definition</h4>
<p>A <strong>distributed system</strong> is a collection of <em>autonomous computing elements</em> that appears to its users as a <em>single coherent system</em>. <span class="src">(Tanenbaum &amp; Van Steen, the definition used in the class deck)</span></p>
<p>More precisely: <em>&ldquo;a system in which hardware or software components located at networked computers communicate and coordinate their actions only by passing messages.&rdquo;</em> <span class="src">(Coulouris, Dollimore, Kindberg &amp; Blair &mdash; recommended textbook 1)</span></p>
</div>
<!-- dcc-fig:ch1/chapter1-int-to-distbd-sys-s04-002.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/chapter1-int-to-distbd-sys-s04-002.webp" alt="1.1 Introduction" width="353" height="280" loading="lazy" decoding="async">
<figcaption><strong>slide 4</strong> &middot; Chapter1_Int to Distbd_Sys.pptx &mdash; 1.1 Introduction</figcaption>
</figure>
<!-- /dcc-fig -->
<p>Both halves of the first definition are load-bearing, and the exam answer is stronger if you say why:</p>
<ul>
<li><strong>Autonomous computing elements</strong> &mdash; each node has its own clock and its own idea of what time it is, makes its own decisions, and can fail on its own. Nothing is in charge of the whole system, which is what makes distribution hard.</li>
<li><strong>Appears as a single coherent system</strong> &mdash; the user should not have to know which machine holds their file, how many machines are involved, or that any of them are remote. This is the <em>transparency</em> goal, and it is what separates a distributed <em>system</em> from a set of computers that merely happen to be networked.</li>
</ul>
<!-- dcc-fig:ch1/chapter1-int-to-distbd-sys-s02-001.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/chapter1-int-to-distbd-sys-s02-001.webp" alt="The deck&#x27;s opening slide: the technologies the course&#x27;s field rests on - virtualized infrastructure, global data consistency, multi-master and CAP-theorem solutions with fault tolerance, active-active replication, cloud computing and hyperscale, on-demand resource pooling, real-time streaming - under the deck&#x27;s own line, that distributed systems are the backbone of our connected present." width="1408" height="768" loading="lazy" decoding="async">
<figcaption><strong>slide 2</strong> &middot; Chapter1_Int to Distbd_Sys.pptx &mdash; The deck&#x27;s opening slide: the technologies the course&#x27;s field rests on - virtualized infrastructure, global data consistency, multi-master and CAP-theorem solutions with fault tolerance, active-active replication, cloud computing and hyperscale, on-demand resource pooling, real-time streaming - under the deck&#x27;s own line, that distributed systems are the backbone of our connected present.</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>1.1.1 The three characteristics the definition implies</h3>
<p>The class deck singles these three out as the ones the definition itself forces, and every later unit is a consequence of one of them.</p>

<table class="comparison-table">
<thead>
<tr><th>Characteristic</th><th>What it means</th><th>Where it bites later in the course</th></tr>
</thead>
<tbody>
<tr>
<td><strong>Concurrency</strong></td>
<td>Programs running on different machines share resources and execute at the same time. This is what lets code run on many machines at once, reducing latency and increasing throughput.</td>
<td>Mutual exclusion (Unit 3) exists because two nodes may want the same resource at the same moment.</td>
</tr>
<tr>
<td><strong>No global clock</strong></td>
<td>Each machine has its own clock and there is no single universal time. Synchronisation across networks is difficult, and communication happens only by passing messages.</td>
<td>This is the whole subject of Unit 3.1&ndash;3.2: Cristian's algorithm and NTP to get clocks close, Lamport's and vector clocks to order events when they cannot be made exact.</td>
</tr>
<tr>
<td><strong>Independent failures</strong></td>
<td>Any single component can fail without bringing the system down. The system must tolerate <em>partial failure</em>: some part is broken, the rest keeps working.</td>
<td>Replication and consistency in Unit 4, and the failure model in 1.4.4.</td>
</tr>
</tbody>
</table>
<div class="concept-box tip">
<h4>Answering &ldquo;define a distributed system&rdquo; for 2 marks</h4>
<p>Give the Tanenbaum definition in one sentence, then the three characteristics as three words &mdash; <em>concurrency, no global clock, independent failures</em>. Two marks is two things: the definition and the fact that you know what follows from it. A single line with no characteristics usually scores one.</p>
</div>

<h3>1.1.2 Further characteristics</h3>
<p>Beyond the three the definition forces, the course material lists the properties a distributed system is expected to have. They are the vocabulary the rest of the paper is written in, so they are worth naming:</p>

<table class="comparison-table">
<thead>
<tr><th>Characteristic</th><th>Explanation</th><th>Example</th></tr>
</thead>
<tbody>
<tr><td><strong>Heterogeneity</strong></td><td>Components differ in network, hardware architecture, operating system, programming language and implementation, and still have to work together.</td><td>A Windows client calling a Linux service over HTTP.</td></tr>
<tr><td><strong>Openness</strong></td><td>The system offers services through published, standard interfaces so components can be added and removed without disrupting the rest.</td><td>REST APIs, so any platform can integrate.</td></tr>
<tr><td><strong>Security</strong></td><td>Confidentiality, integrity and availability must all hold, and they are harder here because parts travel over networks nobody controls.</td><td>Encryption, authentication, authorisation.</td></tr>
<tr><td><strong>Scalability</strong></td><td>The system keeps working as it grows &mdash; in size, in geography and in administration.</td><td>Adding servers for a sale event.</td></tr>
<tr><td><strong>Transparency</strong></td><td>Internals are hidden: separate machines look like one.</td><td>A remote file read over NFS feels local.</td></tr>
<tr><td><strong>Fault tolerance</strong></td><td>Failures are masked and the system recovers from errors.</td><td>One search replica dies; search still answers.</td></tr>
</tbody>
</table>
<h3>1.1.3 Advantages and disadvantages</h3>
<p>The deck gives these as two columns, and the two columns are the same properties seen from opposite sides: sharing is the advantage and the security exposure is its price; scalability is the advantage and administration and fault-finding across many nodes its price. Reading them in pairs is also what makes them answerable under time pressure.</p>

<table class="comparison-table">
<thead>
<tr><th>Advantages</th><th>Disadvantages</th></tr>
</thead>
<tbody>
<tr><td><strong>Economics</strong> &mdash; a collection of microprocessors gives better price/performance than a single large machine.</td><td><strong>Security</strong> is the main concern &mdash; every connection and every node has to be secured, and there are more of them.</td></tr>
<tr><td><strong>Scalable</strong> &mdash; capacity can be added a machine at a time.</td><td><strong>Loss of data</strong> is possible while data moves across nodes.</td></tr>
<tr><td><strong>Data and resource sharing</strong> &mdash; hardware and software both.</td><td><strong>Complexity</strong> of developing software for a distributed system is much higher than for one machine.</td></tr>
<tr><td><strong>Flexibility</strong> &mdash; the workload can be spread over the connected machines.</td><td><strong>Distribution of control</strong> &mdash; administration becomes difficult, and faults are harder to detect because no one node sees the whole system.</td></tr>
<tr><td><strong>Communication</strong> &mdash; fast, reliable, and inherently distributed among users.</td><td></td></tr>
<tr><td><strong>Availability</strong> &mdash; and <strong>incremental growth</strong>: computing power can be added in small increments rather than in one large step.</td><td></td></tr>
</tbody>
</table>

<p>Two of the items are worth naming in any answer because the rest of the course uses them again. <strong>Economics</strong> &mdash; a collection of microprocessors gives better price/performance than one large machine &mdash; is the commercial argument the whole course rests on, and it is the argument cloud computing renews in Unit 5. <strong>Distribution of control</strong> is the disadvantage that returns as the hardest kind of scalability, because it is a problem of organisations and people rather than of hardware. When a question asks for advantages and disadvantages, two of each with a sentence of explanation read better than all ten items listed.</p>

<h2>1.2 Goals of Distributed Systems</h2>

<p>The class deck puts <strong>four</strong> design goals that must be met for a system to work in a distributed environment. This is exactly what Group B question 5 asks, and four is the number to quote.</p>

<div class="concept-box important">
<h4>Goal 1 &mdash; Resource sharing</h4>
<p>Sharing of available physical or non-physical resources &mdash; remote data, files, printers, processors, storage &mdash; in an efficient manner. The main motivation for building a distributed system in the first place is to share resources, whether hardware or software.</p>
<ul>
<li><strong>Cost-effective implementation</strong> of the whole system follows from it: pooled resources beat buying each node its own.</li>
<li><strong>Collaboration</strong> between nodes and users is required, with information exchange between them.</li>
<li><strong>The cost</strong> is that every shared resource widens the security surface.</li>
</ul>
</div>

<div class="concept-box important">
<h4>Goal 2 &mdash; Openness</h4>
<p>Services are specified through standard rules, and their <strong>syntax and semantics</strong> are defined through an interface written in an <strong>IDL (Interface Definition Language)</strong>.</p>
<ul>
<li>The IDL describes the function name, its parameters, its return values, the exceptions it can raise and how the service is used &mdash; but the interface itself is <strong>neutral</strong>: it does not commit to a language or platform.</li>
<li>Openness is what buys <strong>interoperability</strong> (two implementations using each other's services) and <strong>portability</strong> (an application written for one distributed system working correctly on another with the same implementations).</li>
<li>Components can be <strong>added and removed without affecting the rest</strong> of the system.</li>
<li>The first step in openness is <strong>publishing</strong> the documentation of the components and their interfaces so other developers can build against them.</li>
</ul>
</div>

<div class="concept-box important">
<h4>Goal 3 &mdash; Transparency</h4>
<p>The realisation of a single coherent system by <strong>hiding the processes and resources</strong> that make it up. Transparency is not one property but a family of them; the class deck attributes this list to Tanenbaum, and the recommended textbook (Coulouris, Table 1.1) gives the full set:</p>
<table class="comparison-table">
<thead>
<tr><th>Form</th><th>What is hidden</th></tr>
</thead>
<tbody>
<tr><td><strong>Access</strong></td><td>The differences in data representation and how a resource is accessed &mdash; a local file and a remote file are read the same way.</td></tr>
<tr><td><strong>Location</strong></td><td>Where the resource physically is; the name carries no address.</td></tr>
<tr><td><strong>Migration</strong></td><td>That a resource may move to another location while in use.</td></tr>
<tr><td><strong>Relocation</strong></td><td>That a resource may move while it is being used, without the user noticing.</td></tr>
<tr><td><strong>Replication</strong></td><td>That extra copies exist &mdash; the user sees one resource, not three replicas.</td></tr>
<tr><td><strong>Concurrency</strong></td><td>That other users and processes are sharing the same resource.</td></tr>
<tr><td><strong>Failure</strong></td><td>That a component failed and was recovered from &mdash; work is completed despite partial failure.</td></tr>
<tr><td><strong>Persistence</strong></td><td>Whether a resource is stored in memory or on disk.</td></tr>
</tbody>
</table>
</div>
<!-- dcc-fig:ch1/chapter1-int-to-distbd-sys-s12-004.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/chapter1-int-to-distbd-sys-s12-004.webp" alt="Design Goals…" width="562" height="241" loading="lazy" decoding="async">
<figcaption><strong>slide 12</strong> &middot; Chapter1_Int to Distbd_Sys.pptx &mdash; Design Goals…</figcaption>
</figure>
<!-- /dcc-fig -->
<div class="concept-box important">
<h4>Goal 4 &mdash; Scalability</h4>
<p>A system is scalable when it can grow without losing what makes it usable. The class material breaks the goal into what has to be controlled, and it is the four constraints that earn the marks:</p>
<ul>
<li><strong>Controlling the cost of physical resources</strong> &mdash; cost should increase <em>linearly</em> with the size of the system, not faster.</li>
<li><strong>Controlling performance loss</strong> &mdash; a system twice the size must not be dramatically slower per operation.</li>
<li><strong>Preventing software resources from running out</strong> &mdash; address space, file descriptors, port numbers, names.</li>
<li><strong>Avoiding performance bottlenecks</strong> &mdash; the practical answer is <strong>decentralised algorithms</strong> with no single node that everyone must talk to, plus <strong>caching and replication</strong>, which is how the Web scales.</li>
</ul>
</div>

<div class="concept-box tip">
<h4>If you can only remember four words</h4>
<p>Resource sharing, Openness, Transparency, Scalability. Write them as four headings and put two sentences under each &mdash; that structure alone is worth most of a 4-mark answer, and it is what the marker is looking for.</p>
</div>

<h3>1.2.1 Main problems and challenges</h3>
<p>The deck names four problems, and they map onto the four goals of 1.2 &mdash; each goal exists because its corresponding problem does. That mapping is the strongest way to write this answer.</p>

<h4>Heterogeneity</h4>
<p>Heterogeneous components must be able to interoperate, and that applies to all networks, hardware architectures, operating systems, programming languages and written programs. Three things are used to mask it:</p>

<p>What makes heterogeneity a <em>problem</em> rather than a fact is that the differences are not only about hardware: a program that runs correctly on one node cannot simply be moved to another, and two nodes may disagree about representation, protocol and meaning. The three answers above are not interchangeable, and the examinable difference between them is their <strong>reach</strong>. <em>Middleware</em> masks the differences inside one organisation's systems and gives an application a programming abstraction it can use directly &mdash; Unit 4.3 treats this properly, with CORBA, Java RMI, MQTT and AMQP as its families. <em>Internet protocols</em> mask the differences across the whole world, at the price of the lowest common denominator that everyone agrees to speak. <em>Mobile code</em> removes the assumption that a program stays where it was written, sending it to run where the data already is.</p>
<ul>
<li><strong>Middleware</strong> &mdash; a software layer that provides a programming abstraction and hides the heterogeneity of the underlying networks, hardware, operating systems and languages. Examples: <em>CORBA</em> (Common Object Request Broker Architecture), <em>ODBC</em>, <em>JDBC</em>, <em>RMI</em>. It supplies services so applications can exchange data in a standard way.</li>
<li><strong>Internet protocols</strong> &mdash; the common set every node already speaks.</li>
<li><strong>Mobile code</strong> &mdash; code that travels to the data instead of the data travelling to the code.</li>
</ul>
<!-- dcc-fig:ch1/chapter1-int-to-distbd-sys-s14-005.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/chapter1-int-to-distbd-sys-s14-005.webp" alt="Middleware: Applies to a software layer, provides a programming abstraction, and masks the heterogeneity of the underlying networks, hardware, operating systems and programming lan" width="463" height="265" loading="lazy" decoding="async">
<figcaption><strong>slide 14</strong> &middot; Chapter1_Int to Distbd_Sys.pptx &mdash; Middleware: Applies to a software layer, provides a programming abstraction, and masks the heterogeneity of the underlying networks, hardware, operating systems and programming lan</figcaption>
</figure>
<!-- /dcc-fig -->
<h4>Reliability</h4>
<ul>
<li><strong>Availability</strong> &mdash; the fraction of time the system is usable, improved by <strong>redundancy</strong>.</li>
<li><strong>Consistency and security</strong> must be maintained alongside it.</li>
<li><strong>Fault tolerance</strong> &mdash; failures must be masked and the system must recover from errors.</li>
</ul>

<p>Two of those words need separating, and the textbook gives the distinction with an example worth keeping: <strong>availability</strong> is the fraction of time a system is usable, while <strong>reliability</strong> is the property of running continuously without interruption. A system that goes down for one millisecond every hour has an availability above 99.9999% and is still unreliable; a system that never crashes but is shut down for two fixed weeks every August is highly reliable and only about 96% available. <strong>Redundancy</strong> is what raises availability &mdash; a spare node, a second copy, a second route &mdash; and it is why replication becomes a topic of its own later (4.1.7). In the wider sense reliability is one of the four requirements Tanenbaum groups under <strong>dependability</strong>: availability, reliability, safety and maintainability. Naming the group is a cheap way to make a 4-mark answer look complete.</p>

<h4>Security</h4>
<p>Security has to fulfil three components &mdash; <strong>Confidentiality, Integrity and Availability</strong> (the CIA triad). <strong>Confidentiality</strong> is that information is disclosed only to those entitled to see it; <strong>integrity</strong> is that it is not altered, by accident or by an attacker; <strong>availability</strong> is that the service can be used when it is needed. The mechanisms adopted are <strong>encryption</strong> (a message an eavesdropper captures is unreadable), <strong>authentication</strong> (the parties are who they claim to be) and <strong>authorisation</strong> (an authenticated party may do only what it is permitted to do). The deck names two challenges that remain open, and both return later in the course: <strong>denial-of-service</strong> attacks, where the aim is not to read or change anything but to make the service unavailable &mdash; an attack on the third component directly &mdash; and the security of <strong>mobile code</strong>, where a program arriving from elsewhere runs on your machine and the question is what it may touch. Unit 8 develops both in the cloud setting, where a provider and a tenant trust each other only as far as the contract says.</p>

<h4>Scalability</h4>
<p>Scalability is not one problem but three, and the textbook names them. <strong>Size scalability</strong> &mdash; more users or resources must be supported, which centralised services cannot do because of their own limits. <strong>Geographical scalability</strong> &mdash; users and resources are far apart, so communication delays are unavoidable and designs that assume quick responses stop working. <strong>Administrative scalability</strong> &mdash; several independent organisations must share one system without giving up control of their own resources; Tanenbaum is blunt that this is the hardest of the three, because its obstacles are political and human rather than technical. The four things the deck asks you to control are the symptoms: the cost of physical resources (which should rise linearly with size, not faster), the loss of performance, software resources running out, and performance bottlenecks. The three techniques are the treatment: <strong>decentralised algorithms</strong>, so that no node holds all the state and none becomes the bottleneck; and <strong>caching</strong> and <strong>replication</strong>, so that work is done near where it is needed &mdash; which is exactly how the Web itself scales (1.3.1).</p>

<h3>1.2.2 Resource sharing, and what a service is</h3>
<p>Resource sharing is goal 1 of 1.2; this section is the deck's concrete account of it, and it introduces the word <em>service</em> that Unit 2 builds on.</p>

<p>The distinction worth holding is <strong>resource against service</strong>. A resource is the thing itself &mdash; a printer, a file, a search index; a service is the interface that manages a collection of related resources and decides who may use them and how. That is why the deck's example is a <em>file service</em> offering read, write and delete rather than the files themselves: what makes sharing possible is the interface. It is the same shift of vocabulary that Unit 2 formalises when it turns services into <em>web services</em> with a description and a protocol (2.4), and it is why the paper can ask about sharing in Unit 1 and about services in Unit 2 without repeating itself.</p>
<ul>
<li>Users of a system tend to share resources: <strong>hardware</strong> (a printer), <strong>data</strong> (files) and <strong>specific functionality</strong> (a search engine).</li>
<li>A <strong>service</strong> manages a collection of related resources and provides functionality to users. File sharing, for example, is initiated by a <em>file service</em> providing read, write and delete operations on files.</li>
<li>Services on other computers can only be invoked <strong>by communication</strong> &mdash; which is the sentence Unit 2 begins from.</li>
</ul>

<h2>1.3 Examples of Distributed Systems</h2>

<p>Sub-topic 1.3 names three systems by name, so the exam can ask you to identify or place them. The deck also lists the application areas that motivate the whole field.</p>

<table class="comparison-table">
<thead>
<tr><th>System</th><th>What it is</th><th>Why it is a distributed system</th></tr>
</thead>
<tbody>
<tr>
<td><strong>Google File System (GFS)</strong></td>
<td>Google's cluster file system: a single master holds the metadata, files are split into large chunks, and chunks are replicated across many chunk servers.</td>
<td>Autonomous nodes cooperating over a network to present one file system; it is built precisely <em>because</em> components fail, so it treats failure as normal rather than exceptional.</td>
</tr>
<tr>
<td><strong>Hadoop / HDFS</strong></td>
<td>The open-source descendant of GFS plus MapReduce. HDFS runs a NameNode for metadata and many DataNodes holding replicated blocks.</td>
<td>Same shape, same reason: files look like one system while storage and computation are spread over commodity machines.</td>
</tr>
<tr>
<td><strong>BitTorrent</strong></td>
<td>Peer-to-peer file distribution: a file is split into pieces and every peer that holds pieces also serves them.</td>
<td>The textbook peer-to-peer model &mdash; no client and no server, all peers play the same role, and any one computer holds only a small part of the data.</td>
</tr>
</tbody>
</table>

<p>Applications the deck lists as the reason distributed systems exist: web search, finance and commerce, creative industries and entertainment, healthcare, education, transport and logistics, massive online multiplayer games, and financial trading. The last two are the demanding ones &mdash; both need low, predictable latency across the world.</p>

<h3>1.3.1 The Web as a distributed system</h3>
<p>The deck also lists the Web's own challenges, useful as a concrete example of distribution problems in the wild:</p>
<ul>
<li><strong>Dangling links</strong> &mdash; a resource is deleted but links to it remain.</li>
<li><strong>Slow response</strong> to web users.</li>
<li><strong>Lack of a proper user interface.</strong></li>
</ul>

<h2>1.4 Models of Distributed Systems</h2>

<p>The syllabus names three architecture models to know: <strong>client-server</strong>, <strong>peer-to-peer</strong> and <strong>multitier</strong>. Architecture models describe the <em>placement of the parts and the relationships between them</em>; the deck pairs them with <em>fundamental</em> models, which describe the properties all architectures share.</p>
<h3>1.4.1 Client-server</h3>
<p>The usual base pattern, built on a simple <strong>request/reply</strong> protocol: the client sends a request (invocation) message asking for a service, the server does the work and returns either the result or an error code. In practice the request/reply is carried out with send/receive primitives, or through <strong>RPC</strong> or <strong>RMI</strong> so it reads like a local call.</p>
<!-- dcc-fig:ch1/chapter1-int-to-distbd-sys-s18-006.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/chapter1-int-to-distbd-sys-s18-006.webp" alt="Contd.." width="852" height="492" loading="lazy" decoding="async">
<figcaption><strong>slide 18</strong> &middot; Chapter1_Int to Distbd_Sys.pptx &mdash; Contd..</figcaption>
</figure>
<!-- /dcc-fig -->
<ul>
<li><strong>Strength:</strong> simple to reason about, and a natural home for authority &mdash; one place to control access and one place that knows the state.</li>
<li><strong>Weakness:</strong> the server is a bottleneck and a single point of failure, and it does not scale by adding peers.</li>
</ul>

<p>Hold the model as one property rather than a picture: <strong>the server is a distinguished process that owns the service, and the client is any process that needs it</strong>. Because the ownership is explicit, authority is easy &mdash; one place holds the state, one place enforces access, and one place fails. That same concentration is the model's cost, and it is the reason the other two models exist. The pattern appears three times later in this course: as the interaction style of <strong>RPC and RMI</strong> (2.1&ndash;2.2), as the <em>service interface</em> a server exposes to say what may be called remotely, and inside the file service architecture of 4.1.5, where a single <em>client module</em> hides two separate server-side services behind one API. Since the exam asks you to <em>differentiate</em> this model from peer-to-peer <em>with examples</em>, keep one concrete pair ready: a web browser and a web server, or an NFS client and a file server &mdash; in both, a request/reply pair with a distinguished server.</p>

<h3>1.4.2 Peer-to-peer</h3>
<p>All processes (or objects) play the <strong>same role</strong>. They interact without any distinction between clients and servers, and the pattern of communication depends on the application. A large number of data objects are shared, and <em>any individual computer holds only a small part</em> of the application database. Processing and communication load is spread across many computers and links &mdash; it is the most general and most flexible model.</p>
<!-- dcc-fig:ch1/chapter1-int-to-distbd-sys-s19-007.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/chapter1-int-to-distbd-sys-s19-007.webp" alt="Peer-to-peer  All process or objects play the same role. Processes (objects) interact without a particular distinction between clients and servers. The pattern of communication dep" width="362" height="286" loading="lazy" decoding="async">
<figcaption><strong>slide 19</strong> &middot; Chapter1_Int to Distbd_Sys.pptx &mdash; Peer-to-peer  All process or objects play the same role. Processes (objects) interact without a particular distinction between clients and servers. The pattern of communication dep</figcaption>
</figure>
<!-- /dcc-fig -->
<p>Its problems, which the deck lists explicitly and an exam answer should mention: <strong>high complexity</strong> because objects must be placed cleverly, <strong>retrieving</strong> the objects you need among many peers, and <strong>maintaining a potentially large number of replicas</strong>.</p>

<p>Against client-server the difference is <strong>authority versus symmetry</strong>: the first concentrates control in one process, the second removes the distinction entirely, and almost everything each model costs follows from that one choice. The promise here is availability without a distinguished server &mdash; no single node's failure ends the service, and capacity grows with the number of participants rather than with the size of one machine. The cost is the three problems above, which are really three questions: <em>where should an object be placed</em> so that it can be found cheaply, <em>how is it found</em> among many peers, and <em>how many copies exist</em> and how are they kept equal. The textbook's example of resource sharing at its most successful is exactly this model &mdash; file-sharing networks such as BitTorrent, where users share files across the Internet with no central server at all &mdash; and it is the example to reach for in the comparison question.</p>

<h3>1.4.3 Multitier</h3>
<p>The client-server idea extended into layers, so each tier can be scaled and replaced on its own. The deck's illustration of this is the <em>three-tier application as a distributed system</em>: a presentation tier (the client), an application or logic tier (the server), and a data tier behind it. Split by function, the same system can serve thousands of clients from a handful of logic servers.</p>
<!-- dcc-fig:ch1/chapter1-int-to-distbd-sys-s05-003.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/chapter1-int-to-distbd-sys-s05-003.webp" alt="Three Tier Application as Distributed System" width="907" height="797" loading="lazy" decoding="async">
<figcaption><strong>slide 5</strong> &middot; Chapter1_Int to Distbd_Sys.pptx &mdash; Three Tier Application as Distributed System</figcaption>
</figure>
<!-- /dcc-fig -->
<figure class="figure-wide figure-wrap">
<svg class="figure wide" viewBox="0 0 780 250" role="img" aria-label="Three architecture models side by side: client and server with a request and reply arrow; four identical peers connected in a ring with no distinguished server; and a multitier stack of presentation, application and data tiers">
<defs><marker id="fd1a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="flow-arrow-head"/></marker></defs>

<text class="flow-label" x="135" y="22" text-anchor="middle">Client&ndash;server</text>
<rect class="flow-box phase1" x="45" y="38" width="180" height="44" rx="9"/>
<text class="flow-text" x="135" y="65">Client</text>
<rect class="flow-box phase2" x="45" y="150" width="180" height="44" rx="9"/>
<text class="flow-text" x="135" y="177">Server</text>
<path class="flow-arrow" d="M115,84 V146" marker-end="url(#fd1a)"/>
<path class="flow-arrow" d="M155,146 V84" marker-end="url(#fd1a)"/>
<text class="flow-label" x="96" y="120" text-anchor="middle">request</text>
<text class="flow-label" x="175" y="120" text-anchor="middle">reply</text>

<text class="flow-label" x="387" y="22" text-anchor="middle">Peer-to-peer</text>
<rect class="flow-box phase3" x="297" y="38" width="80" height="40" rx="9"/>
<text class="flow-text" x="337" y="63">Peer</text>
<rect class="flow-box phase3" x="417" y="38" width="80" height="40" rx="9"/>
<text class="flow-text" x="457" y="63">Peer</text>
<rect class="flow-box phase3" x="297" y="154" width="80" height="40" rx="9"/>
<text class="flow-text" x="337" y="179">Peer</text>
<rect class="flow-box phase3" x="417" y="154" width="80" height="40" rx="9"/>
<text class="flow-text" x="457" y="179">Peer</text>
<path class="flow-arrow" d="M377,58 H417"/>
<path class="flow-arrow" d="M377,174 H417"/>
<path class="flow-arrow" d="M337,78 V154"/>
<path class="flow-arrow" d="M457,78 V154"/>
<path class="flow-arrow" d="M457,78 C520,100 520,140 457,154"/>
<path class="flow-arrow" d="M337,154 C274,140 274,100 337,78"/>
<text class="flow-label" x="387" y="220" text-anchor="middle">no distinguished server</text>

<text class="flow-label" x="642" y="22" text-anchor="middle">Multitier</text>
<rect class="flow-box phase1" x="542" y="38" width="200" height="42" rx="9"/>
<text class="flow-text" x="642" y="64">Presentation tier</text>
<path class="flow-arrow" d="M642,80 V104" marker-end="url(#fd1a)"/>
<rect class="flow-box phase2" x="542" y="106" width="200" height="42" rx="9"/>
<text class="flow-text" x="642" y="132">Application tier</text>
<path class="flow-arrow" d="M642,148 V172" marker-end="url(#fd1a)"/>
<rect class="flow-box phase4" x="542" y="174" width="200" height="42" rx="9"/>
<text class="flow-text" x="642" y="200">Data tier</text>
</svg>
<figcaption><strong>Fig 1.1 &mdash; The three architecture models of sub-topic 1.4.</strong> Client&ndash;server is a request/reply pair with a distinguished server; peer-to-peer has no distinguished node and no fixed direction of request; multitier splits the logic into layers that can each be replicated. Drawn from the placement and relationships described in the Chapter 1 deck, slides 17&ndash;19.</figcaption>
</figure>

<p>Read the tiers as a division of labour, not a diagram: the <strong>presentation tier</strong> holds what the user sees, the <strong>application (logic) tier</strong> holds the decisions, and the <strong>data tier</strong> holds the state. The value is that each can be scaled, replaced or moved on its own &mdash; the logic tier is where servers are added as load grows, while the data tier is the one that cannot simply be copied without asking how the copies are kept equal, which is why consistency becomes a topic in its own right (4.1.6). This is also why the deck presents a three-tier application as a distributed system: the tiers <em>are</em> the distribution, and they talk to each other over the network exactly as any client and server do. Unit 2.4's web services and Unit 7's cloud application architectures are both read on top of this picture.</p>

<h3>1.4.4 Fundamental models</h3>
<p>Fundamental models describe, more formally, the properties <em>common to all</em> the architecture models. The deck names three.</p>

<table class="comparison-table">
<thead>
<tr><th>Model</th><th>What it describes</th><th>Key points</th></tr>
</thead>
<tbody>
<tr>
<td><strong>Interaction model</strong></td>
<td>How processes communicate and coordinate: information flow, plus the synchronisation and ordering of activities between processes.</td>
<td>It reflects the fact that communication takes place <em>with delays</em>. It comes in two variants &mdash; see the table below.</td>
</tr>
<tr>
<td><strong>Failure model</strong></td>
<td>Defines and classifies faults, so systems can have predictable behaviour when things break, i.e. be fault-tolerant.</td>
<td>Such a system works as predicted <em>only as long as the real faults behave as the model says</em>. Classes: omission, timing and arbitrary failures.</td>
</tr>
<tr>
<td><strong>Security model</strong></td>
<td>Defines and classifies forms of attack.</td>
<td>Gives a basis for analysing the threats to a system, and is used to design systems that can resist them.</td>
</tr>
</tbody>
</table>

<p>It is hard in a distributed system to put time limits on process execution, message delivery or clock drift. Whether you are allowed to <em>assume</em> such limits is exactly what separates the two variants of the interaction model:</p>

<table class="comparison-table">
<thead>
<tr><th></th><th>Synchronous distributed system</th><th>Asynchronous distributed system</th></tr>
</thead>
<tbody>
<tr><td><strong>Assumption about time</strong></td><td>Strong assumptions about time.</td><td>No assumption about time at all.</td></tr>
<tr><td><strong>Process execution</strong></td><td>Each step has a known lower and upper time bound.</td><td>No bound on execution speed; each step may take arbitrarily long.</td></tr>
<tr><td><strong>Message delivery</strong></td><td>Every message is received within a known bounded time.</td><td>No bound on transmission delay; a message may be received after an arbitrarily long time.</td></tr>
<tr><td><strong>Clocks</strong></td><td>Each local clock's drift from real time has a known bound.</td><td>No bound on clock drift; the drift rate is arbitrary.</td></tr>
<tr><td><strong>Consequence</strong></td><td>You can put a time limit on a reply and treat a timeout as a failure.</td><td>You cannot &mdash; a slow node and a dead node look identical. This is why logical clocks exist (Unit 3.2).</td></tr>
</tbody>
</table>

<h3>1.4.5 Types: cluster, grid and cloud</h3>
<p>The deck closes the unit by grouping distributed systems into three types. This is also the bridge into Unit 5, since the third of them is the subject of the rest of the course.</p>

<table class="comparison-table">
<thead>
<tr><th>Type</th><th>Definition</th><th>Key feature</th></tr>
</thead>
<tbody>
<tr>
<td><strong>Cluster</strong></td>
<td>A parallel or distributed processing system made of interconnected stand-alone computers working cooperatively as a single, integrated computing resource. The computers may be uniprocessor or multiprocessor.</td>
<td><strong>Homogeneity</strong> &mdash; all computers must run the same operating system and be on the same network. Used for highly scalable services (search engines) and for parallel programming, where one program runs in parallel across the machines.</td>
</tr>
<tr>
<td><strong>Grid</strong></td>
<td>A parallel and distributed system that enables the sharing, selection and aggregation of <em>geographically distributed autonomous</em> resources dynamically at runtime, depending on availability, capability, performance, cost and users' quality-of-service requirements.</td>
<td><strong>High degree of heterogeneity</strong>, and five layers &mdash; see below.</td>
</tr>
<tr>
<td><strong>Cloud</strong></td>
<td>Internet-based computing that provides shared processing resources and data to computers and other devices <em>on demand</em>, enabling on-demand access to a shared pool of configurable computing resources.</td>
<td>Metered, elastic and on demand; the three service models (SaaS, PaaS, IaaS) are introduced here and examined in Unit 5.</td>
</tr>
</tbody>
</table>

<h4>The five layers of a grid</h4>
<ol>
<li><strong>Fabric</strong> &mdash; provides the interface to local resources at a specific site, which can then be shared within a virtual organisation.</li>
<li><strong>Connectivity</strong> &mdash; the communication protocols that support grid transactions, including the delegation of rights from authenticated users to programs running on their behalf.</li>
<li><strong>Resource</strong> &mdash; manages a single resource using the functions of the connectivity layer and the interfaces of the fabric layer; responsible for access control.</li>
<li><strong>Collective</strong> &mdash; handles access to multiple resources: resource discovery, allocation and scheduling, and data replication.</li>
<li><strong>Application</strong> &mdash; the applications that use the services the grid provides.</li>
</ol>
<!-- dcc-fig:ch1/chapter1-int-to-distbd-sys-s24-008.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/chapter1-int-to-distbd-sys-s24-008.webp" alt="1.9 Types of Distributed System" width="396" height="272" loading="lazy" decoding="async">
<figcaption><strong>slide 24</strong> &middot; Chapter1_Int to Distbd_Sys.pptx &mdash; 1.9 Types of Distributed System</figcaption>
</figure>
<!-- /dcc-fig -->
<p>The layers are a hierarchy of dependence: each uses the one below it, and only the fabric layer touches resources that are physically installed somewhere. The idea that holds them together is the <strong>virtual organisation</strong> &mdash; a set of users and institutions that share resources under agreed rules &mdash; and the connectivity layer's job is to make that sharing safe by <em>delegating</em> rights: a user authenticates once, and the programs acting on their behalf inherit exactly those rights and no more. Read the five layers against the grid's definition from the table above (heterogeneous, geographically distributed, selected at runtime by availability, capability, performance, cost and quality of service) and the resource and collective layers are where those runtime decisions are actually made.</p>
<div class="concept-box asked">
<h4>Cluster vs grid vs cloud</h4>
<p>One line answers the comparison and is worth quoting: <em>a cluster is homogeneous and local, a grid is heterogeneous and geographically distributed, and a cloud adds on-demand, metered access to a shared pool on top of a grid-like infrastructure.</em> Homogeneity and geography are the two words that carry it.</p>
</div>

`,
  quiz: [
    {
      q: 'Which definition of a distributed system is used by Tanenbaum and Van Steen?',
      options: [
        'A set of computers connected by a local area network and sharing one operating system',
        'A collection of autonomous computing elements that appears to its users as a single coherent system',
        'Any system whose components communicate only through shared memory',
        'A system with one central server that all clients depend on'
      ],
      answer: 1,
      explanation: 'That is the definition the class deck opens with, and both halves matter: "autonomous computing elements" gives independent clocks and independent failures, while "single coherent system" is the transparency goal. The Coulouris wording — components at networked computers that communicate and coordinate only by passing messages — says the same thing from the communication side.'
    },
    {
      q: 'Which three characteristics follow from the definition of a distributed system?',
      options: [
        'Scalability, security and transparency',
        'Concurrency, no global clock, independent failures',
        'Heterogeneity, openness and fault tolerance',
        'Client-server, peer-to-peer and multitier'
      ],
      answer: 1,
      explanation: 'The deck singles these three out because the definition forces them. Each one is the reason for a later unit: concurrency needs mutual exclusion, no global clock needs logical clocks, and independent failures need replication and a failure model.'
    },
    {
      q: 'In an open distributed system, what is an IDL for?',
      options: [
        'Encrypting messages between nodes',
        'Defining the interface of a service — function name, parameters, return values and exceptions — in a platform-neutral way',
        'Translating between different programming languages at runtime',
        'Compressing network traffic between heterogeneous nodes'
      ],
      answer: 1,
      explanation: 'An Interface Definition Language specifies syntax and semantics of services with a neutral interface, which is what makes interoperability (two implementations using each other\u2019s services) and portability possible. Openness also requires the documentation of components and interfaces to be published.'
    },
    {
      q: 'Accessing a remote file so that it feels exactly like a local file is an example of which kind of transparency?',
      options: [
        'Replication transparency',
        'Location transparency',
        'Access transparency',
        'Failure transparency'
      ],
      answer: 2,
      explanation: 'Access transparency hides differences in data representation and how a resource is accessed. Location transparency hides where the resource is, and replication transparency hides that further copies exist — the three are easy to confuse, so name the thing being hidden.'
    },
    {
      q: 'Which of these is NOT one of the four design goals of distributed systems listed in the unit?',
      options: [
        'Resource sharing',
        'Openness',
        'Scalability',
        'Metered billing'
      ],
      answer: 3,
      explanation: 'The four goals are resource sharing, openness, transparency and scalability. Metered billing is a property of cloud service models (Unit 5), not a design goal of distributed systems.'
    },
    {
      q: 'In the peer-to-peer model, which statement is true?',
      options: [
        'One process always acts as the server for the others',
        'All processes play the same role and interact without a client/server distinction',
        'Every peer must hold a full copy of the shared database',
        'Communication is always synchronous and bounded in time'
      ],
      answer: 1,
      explanation: 'All processes play the same role and the communication pattern depends on the application. The deck is explicit that any individual computer holds only a small part of the application database — full copies would defeat the point, and maintaining many replicas is listed as one of peer-to-peer\u2019s problems.'
    },
    {
      q: 'Which problem is specifically listed as a weakness of peer-to-peer systems?',
      options: [
        'The server becomes a bottleneck',
        'High complexity of placing objects, retrieving them, and maintaining a large number of replicas',
        'Inability to share data objects between nodes',
        'Dependence on a single central index'
      ],
      answer: 1,
      explanation: 'A server bottleneck is the client-server weakness. Peer-to-peer has no central authority, and the price is complexity: objects must be placed cleverly, retrieval among many peers is hard, and replicas are numerous.'
    },
    {
      q: 'A system where every message is delivered within a known bounded time is best described as:',
      options: [
        'Asynchronous',
        'Synchronous',
        'Fault-tolerant',
        'Scalable'
      ],
      answer: 1,
      explanation: 'The synchronous model assumes known lower and upper bounds on execution steps, bounded message delivery and a bounded clock drift rate. The asynchronous model assumes none of these — which is why in an asynchronous system a slow node and a dead node cannot be told apart.'
    },
    {
      q: 'Which of the following is a FUNDAMENTAL model rather than an architectural model?',
      options: [
        'Client-server',
        'Peer-to-peer',
        'Multitier',
        'Interaction model'
      ],
      answer: 3,
      explanation: 'Architectural models are about the placement of parts and the relationships between them (client-server, peer-to-peer, multitier). Fundamental models describe properties common to all architectures: the interaction model, the failure model and the security model.'
    },
    {
      q: 'What is the main difference between a cluster and a grid?',
      options: [
        'A cluster is geographically distributed while a grid is local',
        'A cluster is homogeneous and local, while a grid is highly heterogeneous and geographically distributed',
        'A cluster only runs one program at a time',
        'A grid does not allow resource sharing'
      ],
      answer: 1,
      explanation: 'Cluster computing\u2019s defining feature is homogeneity — the same operating system on the same network. A grid explicitly aggregates geographically distributed autonomous resources with a high degree of heterogeneity, and its lowest layer is the fabric layer that exposes local resources.'
    },
    {
      q: 'Which layer of a grid architecture is responsible for resource discovery, allocation and scheduling across multiple resources?',
      options: [
        'Fabric layer',
        'Connectivity layer',
        'Collective layer',
        'Resource layer'
      ],
      answer: 2,
      explanation: 'The collective layer handles access to multiple resources. The fabric layer exposes local resources, the connectivity layer carries grid transactions and delegates rights, and the resource layer manages a single resource and does its access control.'
    },
    {
      q: 'Which three components must a secure distributed system satisfy?',
      options: [
        'Confidentiality, Integrity and Availability',
        'Openness, Transparency and Scalability',
        'Authentication, Replication and Redundancy',
        'Latency, Throughput and Availability'
      ],
      answer: 0,
      explanation: 'The CIA triad. The mechanisms the unit names for achieving it are encryption, authentication and authorisation, and it notes that some challenges remain — denial-of-service attacks and mobile code security.'
    }
  ],
  past: [
    {
      year: 'Model 2025',
      marks: '2',
      repeats: 1,
      q: 'Define a distributed system.',
      occ: [
        { year: 'Model 2025', marks: '2', q: 'Define a distributed system.' }
      ],
      answer: `
<h4>Model answer &mdash; 2 marks</h4>
<p>A <strong>distributed system</strong> is a collection of <strong>autonomous computing elements</strong> that appears to its users as a <strong>single coherent system</strong>. Equivalently, it is a system in which hardware or software components located at networked computers communicate and coordinate their actions <em>only by passing messages</em>.</p>
<p>The definition carries three characteristics:</p>
<ul>
<li><strong>Concurrency</strong> &mdash; multiple processes on different machines execute at the same time and share resources.</li>
<li><strong>No global clock</strong> &mdash; each machine has its own clock, so there is no single universal time and communication is only by messages.</li>
<li><strong>Independent failures</strong> &mdash; any component can fail on its own, so the system must tolerate partial failure.</li>
</ul>
<div class="concept-box tip">
<h4>Where this came from</h4>
<p>Group A, question 1 of the <em>Model Question 2025</em> in the syllabus, worth 2 marks. Group A carries four such questions and the paper says <code>2*4=8</code>, so each is worth 2. One mark is the definition, the other is knowing what follows from it &mdash; the three characteristics are the cheapest way to earn the second.</p>
</div>`
    },
    {
      year: 'Model 2025',
      marks: '4',
      repeats: 1,
      q: 'Explain the goals of distributed systems.',
      occ: [
        { year: 'Model 2025', marks: '4', q: 'Explain the goals of distributed systems.' }
      ],
      answer: `
<h4>Model answer &mdash; 4 marks</h4>
<p>Four goals must be met for a system to work in a distributed environment. They come in pairs &mdash; the first two are about what the system does for its users, the last two about whether it still works when it grows.</p>

<p><strong>1. Resource sharing.</strong> Available physical and non-physical resources &mdash; remote data, files, printers, processors, storage &mdash; are shared efficiently. Sharing is the main motivation for building a distributed system at all, and it gives a cost-effective implementation of the whole system, but it requires collaboration and information exchange between nodes and raises security concerns. <em>Example:</em> a networked printer shared by an office, or a file service exposing read, write and delete operations on remote files.</p>

<p><strong>2. Openness.</strong> Services are specified through standard rules, with their syntax and semantics defined through an interface written in an <strong>IDL (Interface Definition Language)</strong>. The IDL describes the function name, parameters, return values, possible exceptions and how the service is used, while the interface itself stays neutral. Openness gives <strong>interoperability</strong> (two implementations using each other's services) and <strong>portability</strong> (an application written for one distributed system running correctly on another with the same implementations), and it lets components be added or removed without affecting the rest. The first step is publishing the documentation of components and interfaces.</p>

<p><strong>3. Transparency.</strong> The system must realise a single coherent system by hiding its processes and resources. This is a family of properties rather than one: <em>access</em> transparency (a remote resource is used exactly as a local one), <em>location</em> (where the resource is), <em>migration</em> and <em>relocation</em> (that it may move, even while in use), <em>replication</em> (that copies exist), <em>concurrency</em> (that others are sharing it), <em>failure</em> (that a component failed and was recovered from) and <em>persistence</em> (whether storage is memory or disk).</p>

<p><strong>4. Scalability.</strong> The system must keep working as it grows, which means controlling four things: the <em>cost of physical resources</em>, which should rise linearly with size and no faster; <em>performance loss</em>, so a larger system is not dramatically slower per operation; <em>software resources</em>, which must not run out (address space, file descriptors, names); and <em>performance bottlenecks</em>. The practical answer to the last one is <strong>decentralised algorithms</strong> with no single node everyone must talk to, together with <strong>caching</strong> and <strong>replication</strong> &mdash; which is how the Web scales.</p>

<div class="concept-box tip">
<h4>Where this came from</h4>
<p>Group B, question 5 of the <em>Model Question 2025</em>. The paper's arithmetic fixes Group B at 4 marks each: Group A is <code>2*4 = 8</code>, Group C carries two <code>[4+4]</code> questions and so is 8 each, and <code>8 + 7(4) + 3(8) = 60</code>. Four goals, four marks &mdash; name all four and give each one a sentence and an example.</p>
</div>`
    },
    {
      year: 'Model 2025',
      marks: '4',
      repeats: 1,
      q: 'Differentiate between client-server and peer-to-peer architectures with examples.',
      occ: [
        { year: 'Model 2025', marks: '4', q: 'Differentiate between client-server and peer-to-peer architectures with examples.' }
      ],
      answer: `
<h4>Model answer &mdash; 4 marks</h4>
<p>Both are <em>architectural</em> models &mdash; they describe where the parts of a distributed system sit and how they relate. The difference is whether one role is distinguished from the others.</p>

<table class="comparison-table">
<thead>
<tr><th></th><th>Client-server</th><th>Peer-to-peer</th></tr>
</thead>
<tbody>
<tr><td><strong>Roles</strong></td><td>A distinguished server provides a service; clients request it. Roles are fixed.</td><td>All processes or objects play the <em>same</em> role, with no distinction between clients and servers.</td></tr>
<tr><td><strong>Interaction</strong></td><td>A simple request/reply protocol: the client sends a request (invocation), the server does the work and returns a result or an error code.</td><td>The pattern of communication depends on the application; it is not a fixed request/reply direction.</td></tr>
<tr><td><strong>Data placement</strong></td><td>Held and controlled by the server.</td><td>Data objects are shared, and any individual computer holds only a <em>small part</em> of the application database.</td></tr>
<tr><td><strong>Load</strong></td><td>Concentrated on the server, which is a bottleneck and a single point of failure.</td><td>Processing and communication load for access to objects is distributed across many computers and access links.</td></tr>
<tr><td><strong>Strengths</strong></td><td>Simple, one place for authority and access control, and the natural fit for RPC and RMI.</td><td>The most general and most flexible model; scales by adding peers rather than upgrading one machine.</td></tr>
<tr><td><strong>Weaknesses</strong></td><td>The server is a bottleneck and a single point of failure; it does not scale by adding peers.</td><td>High complexity from clever object placement, difficulty retrieving objects, and maintaining a potentially large number of replicas.</td></tr>
<tr><td><strong>Example</strong></td><td>The Web: a browser requests a page from a web server. Or GFS/HDFS, where a single master (NameNode) serves metadata to many clients.</td><td>BitTorrent: a file is split into pieces and every peer that holds pieces also serves them.</td></tr>
</tbody>
</table>

<p>The Multitier model is the third architecture named in the syllabus and can be added in a line: it extends client-server into layers &mdash; presentation, application and data &mdash; so that each tier can be scaled and replaced independently. See <strong>Fig 1.1</strong> in 1.4, which draws all three side by side.</p>

<div class="concept-box tip">
<h4>Where this came from</h4>
<p>Group B, question 6 of the <em>Model Question 2025</em>, worth 4 marks (see the arithmetic in the note on the goals question above). "With examples" is in the question, so the answer must name one per model &mdash; a comparison table with no examples caps the score.</p>
</div>`
    }
  ]
};

;
/* ch2.js */
/* Chapter 2 — Communication in Distributed Systems.

   Syllabus unit 2: 7 hours, 10 marks — the heaviest unit on the paper.
   Sub-topics 2.1 Remote Procedure Calls (RPC), 2.2 Remote Method Invocation
   (RMI), 2.3 Message Passing and Serialization, 2.4 Sockets and Web services
   (REST & SOAP).

   Written from the course's own material, read into `_source/dcc/` by
   tools/dcc_extract.py:

     lecture_notes_all_chapterwise_lecturemain_ch_2_communication_in_ds.txt
         Er. Avijit Karn's 48-slide Chapter 2 deck — distributed objects, RPC
         and its call semantics, RMI and its implementation, message passing
         and MPI, and sockets. Most of its slides are pictures, so the deck's
         own diagrams were OCR'd to recover their labels (slides 6-8, 13-14,
         30-48) — the ten RPC steps below are the deck's slide 8 read off the
         picture, not paraphrase.

     rest_soap_webservices.txt, rest_soap_webservices_lecture.txt
         Hans-Petter Halvorsen's Web Services deck on the SOAP and REST stacks

     messagepassing_referencenote.txt, messagepassing_refnote2.txt
         the message-passing reference notes (PVM/MPI) and the
         Communication (II) notes covering persistence and synchronicity

   Where a fact comes from a reference note rather than the class deck, the text
   says which. */

window.CHAPTERS = window.CHAPTERS || {};
window.CHAPTERS[2] = {
  learn: `

<h2>Unit 2 &mdash; Communication in Distributed Systems</h2>
<p class="unit-meta">Syllabus: 7 hours &middot; 10 marks &middot; sub-topics 2.1&ndash;2.4</p>

<div class="concept-box asked">
<h4>What this unit is worth in the exam</h4>
<ul>
<li><strong>10 marks</strong> &mdash; this is the largest single unit in the syllabus marks-distribution table, and it is not a unit you can skip.</li>
<li><strong>4 marks</strong> &mdash; &ldquo;Describe Remote Procedure Call (RPC) with its working mechanism.&rdquo; (Group B, question 7 of the <em>Model Question 2025</em>)</li>
</ul>
<p>The rest of the unit has no question in the one model paper available, which is worth knowing rather than guessing about: the paper is one sample, and its Group B carries seven of eight questions while Group C carries three of four. A 10-mark unit with one 4-mark question in the sample is exactly the sort of unit a second paper picks up elsewhere, so <strong>learn 2.1 and 2.2 cold, and know 2.3 and 2.4 well enough to write a short answer</strong> &mdash; the four reference notes supplied for this unit are all on 2.3 and 2.4, which is a strong hint about where the teaching time went.</p>
</div>

<h2>Where this unit sits</h2>
<p>Unit 1 established that the components of a distributed system communicate <em>only by passing messages</em>. That is a negative statement about what they cannot do &mdash; they cannot share memory or read each other's clocks. This unit is about what we build on top of it: the programming abstractions that make message passing look like an ordinary call, and the mechanisms underneath them.</p>

<p>Read the unit in two passes. Sections 2.1 and 2.2 are the <em>abstractions above</em> &mdash; RPC and RMI, which hide the message behind a call, and whose whole subject is what has to be agreed for that illusion to survive failure, marshalling and concurrency. Section 2.3 is the <em>mechanism below</em>, message passing taken on its own terms, where nothing is hidden and the programmer does the work. Section 2.4 is the same idea one generation later, where the abstraction is HTTP and a resource rather than a stub and an object. A question on this unit is usually answered from one of the two passes, so knowing which one it is asking about is half the answer.</p>

<div class="concept-box key">
<h4>The one-sentence map of the unit</h4>
<p>RPC makes a <em>procedure</em> call look local, RMI makes a <em>method</em> call on an object look local, message passing admits that it is a message and gives you the primitives, and web services are message passing between programs that were never written to cooperate &mdash; using HTTP because a firewall will let HTTP through and nothing else.</p>
</div>

<h2>2.0 Distributed objects &mdash; the deck's starting point</h2>

<p>The Chapter 2 deck begins with the object-oriented view, before any of RPC or RMI, because it is the vocabulary the rest of the unit assumes. Following the object-oriented programming model, <strong>objects distributed across different address spaces that work together by sharing data and invoking methods are termed distributed objects</strong>. Those address spaces may be multiple processes on one computer or processes on different computers in a network.</p>

<p>Three properties of that definition carry weight:</p>
<ul>
<li><strong>The objects are the communicating entities.</strong> Processes do not exchange raw bytes by hand; they invoke methods on each other. The abstraction is what hides the underlying complexity of distributed programming from the programmer.</li>
<li><strong>Location transparency is what the abstraction buys.</strong> Because a caller does not know where the object is, distributed objects generally communicate using <strong>RMI</strong>.</li>
<li><strong>Local and distributed objects are not equivalent.</strong> This is the honest part of the model, and the deck makes it explicit.</li>
</ul>

<h3>Where a local object and a distributed object differ</h3>
<p>The deck lists six areas. The first column is the local-object reality; the third column is why every mechanism later in this unit exists.</p>

<table class="comparison-table">
<thead>
<tr><th>Area</th><th>A local object</th><th>Consequence for a distributed object</th></tr>
</thead>
<tbody>
<tr><td><strong>Reference</strong></td><td>A pointer or reference into the same address space: one machine word.</td><td>A reference must be meaningful in another address space, which is why the <em>remote object reference</em> and the binder exist (see 2.2).</td></tr>
<tr><td><strong>Request latency</strong></td><td>A few instructions; the call is bounded by local memory speed.</td><td>Every call crosses a network. Latency is orders of magnitude larger and <em>variable</em>, which is why a design that makes many small calls performs badly.</td></tr>
<tr><td><strong>Object activation</strong></td><td>The object is in memory because the process is running.</td><td>The remote object may not be instantiated yet, so the call may have to activate it first. This is object activation.</td></tr>
<tr><td><strong>Parallelism</strong></td><td>Two calls on one object are serialised by that process.</td><td>Calls can arrive from several clients at once, so the programmer must consider the object's behaviour in a <em>concurrent</em> environment.</td></tr>
<tr><td><strong>Failure</strong></td><td>Either the whole process works or it does not.</td><td>Partial failure: a remote call can be lost, the server can crash after executing, or the client can crash after asking. This produces the whole of call semantics.</td></tr>
<tr><td><strong>Security</strong></td><td>Enforced by the operating system on the local machine.</td><td>Data crosses a network between parties that do not trust each other, so access control and authentication move into the middleware.</td></tr>
</tbody>
</table>

<p>Two mechanisms are used for communication between distributed objects, and they are the two halves of this unit's programming model: <strong>Remote Procedure Call (RPC)</strong> and <strong>Remote Method Invocation (RMI)</strong>.</p>

<h2>2.1 Remote Procedure Call (RPC)</h2>

<p>An RPC is <strong>an interaction between a client and a server in which the client invokes a procedure that resides remotely on a server; the server executes the procedure and passes the result back to the client</strong>. During the call the client's calling of the procedure is <em>blocked</em>, and is resumed only after the result arrives. In other words the caller pays blocking, but it gets the ordinary single-process procedure-call model.</p>

<p>It is <strong>based on the single-process procedure call model</strong> &mdash; that is the entire point of the name &mdash; and so it is a <em>high-level</em> network communication interface, not a low-level one. A server process exposes a <strong>service interface</strong> defining the procedures available for remote calling, and works under a <strong>request&ndash;reply protocol</strong> that deliberately omits the object reference from request messages: the request names a procedure, not an object.</p>

<div class="concept-box warn">
<h4>What conventional RPC does <em>not</em> give you</h4>
<p>Simple RPC does not maintain <strong>access transparency</strong>: the data representation and the method of object access are not hidden from the programmer, so a remote call does not look exactly like a local one. Keeping access transparency is exactly what the stub layer exists to fix, and what 2.2's proxy layer formalises.</p>
</div>
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s06-009.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s06-009.webp" alt="Figure: Principle of RPC between a client and server program.  In the above conventional RPC, access transparency is not maintained i.e. data representation and method of an object" width="827" height="411" loading="lazy" decoding="async">
<figcaption><strong>slide 6</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx &mdash; Figure: Principle of RPC between a client and server program.  In the above conventional RPC, access transparency is not maintained i.e. data representation and method of an object</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>2.1.1 How RPC works in ten steps</h3>
<p>The mechanism is the sequence below. Steps 1&ndash;3 are the client side, 4&ndash;7 the server side, 8&ndash;10 the reply. The middle of the sequence is where the abstraction lives: the client procedure does not know it spoke to a stub, and the server procedure does not know it was called across a network.</p>

<figure class="figure-wide figure-wrap">
<svg class="figure wide" viewBox="0 0 800 400" role="img" aria-label="Ten-step remote procedure call sequence: client process calls the client stub, the stub marshals parameters and calls the local kernel, the kernel sends the message over the network, the remote operating system passes it to the server stub, which unmarshals it and calls the server, and the result returns along the same path in reverse">
<defs><marker id="f2a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="flow-arrow-head"/></marker></defs>

<text class="flow-label" x="120" y="24" text-anchor="middle">Client machine</text>
<text class="flow-label" x="680" y="24" text-anchor="middle">Server machine</text>

<rect class="flow-box phase1" x="30" y="40" width="180" height="46" rx="9"/>
<text class="flow-text" x="120" y="68">1. Client procedure</text>
<rect class="flow-box phase2" x="30" y="118" width="180" height="46" rx="9"/>
<text class="flow-text" x="120" y="146">2. Client stub</text>
<rect class="flow-box phase4" x="30" y="196" width="180" height="46" rx="9"/>
<text class="flow-text" x="120" y="224">3. Client kernel</text>

<rect class="flow-box phase1" x="590" y="40" width="180" height="46" rx="9"/>
<text class="flow-text" x="680" y="68">6. Server</text>
<rect class="flow-box phase2" x="590" y="118" width="180" height="46" rx="9"/>
<text class="flow-text" x="680" y="146">5. Server stub</text>
<rect class="flow-box phase4" x="590" y="196" width="180" height="46" rx="9"/>
<text class="flow-text" x="680" y="224">4. Remote OS</text>

<path class="flow-arrow" d="M120,86 V114" marker-end="url(#f2a)"/>
<path class="flow-arrow" d="M120,164 V192" marker-end="url(#f2a)"/>
<path class="flow-arrow" d="M680,192 V168" marker-end="url(#f2a)"/>
<path class="flow-arrow" d="M680,114 V90" marker-end="url(#f2a)"/>

<path class="flow-arrow" d="M214,219 H586" marker-end="url(#f2a)"/>
<text class="flow-label" x="400" y="210" text-anchor="middle">request message (procedure number + marshalled arguments)</text>

<path class="flow-arrow" d="M586,263 H214" marker-end="url(#f2a)"/>
<text class="flow-label" x="400" y="285" text-anchor="middle">reply message (marshalled result)</text>

<rect class="flow-box phase3" x="290" y="250" width="220" height="34" rx="8"/>
<text class="flow-text" x="400" y="272">network &mdash; connectionless or connection-oriented</text>

<text class="flow-text" x="400" y="326" text-anchor="middle">7&ndash;10. The result returns along the same path in reverse:</text>
<text class="flow-label" x="400" y="350" text-anchor="middle">server stub packs a message &rarr; server OS &rarr; client OS &rarr; client stub unmarshals &rarr; waiting client procedure</text>
<text class="flow-label" x="400" y="376" text-anchor="middle">the client procedure is blocked from step 1 until the reply arrives</text>
</svg>
<figcaption><strong>Fig 2.1 &mdash; The functional steps in a remote procedure call.</strong> The stub layer on each side is what makes a network call look like a local one. Steps 1&ndash;10 are the deck's slide 8 verbatim; the two call-sites are the deck's principle-of-RPC diagram, where the client's <em>call remote procedure</em> sits immediately above a <em>wait for result</em> that does not return until the reply.</figcaption>
</figure>
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s07-010.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s07-010.webp" alt="How modern RPC works?" width="719" height="307" loading="lazy" decoding="async">
<figcaption><strong>slide 7</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx &mdash; How modern RPC works?</figcaption>
</figure>
<!-- /dcc-fig -->
<ol>
<li><strong>The client procedure calls the client stub in the normal way.</strong> From here nothing is unusual &mdash; it is an ordinary local call.</li>
<li><strong>The client stub builds a message</strong> including the parameters and the name or number of the procedure to be called, and calls the local operating system. Packaging the arguments into a network message is called <strong>marshalling</strong>.</li>
<li><strong>The client sends the message to the remote OS</strong> via a system call to the local kernel. To transfer the message some protocol is used, either connectionless or connection-oriented.</li>
<li><strong>The remote OS gives the message to the server stub.</strong></li>
<li><strong>The server stub unpacks the parameters</strong> &mdash; unmarshals them &mdash; and calls the server.</li>
<li><strong>The server does the work</strong> and returns the result to the stub.</li>
<li><strong>The server stub packs the result into a message</strong> and calls its local OS.</li>
<li><strong>The server's OS sends the message</strong> to the client's OS.</li>
<li><strong>The client's OS gives the message to the client stub.</strong></li>
<li><strong>The stub unpacks the result</strong> and returns it to the waiting client procedure.</li>
</ol>
<!-- dcc-fig:ch2/messagepassing-refnote2-p09.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/messagepassing-refnote2-p09.webp" alt="Communication (II)" width="1240" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 9</strong> &middot; MessagePassing_refnote2.pdf &mdash; Communication (II)</figcaption>
</figure>
<!-- /dcc-fig -->
<div class="concept-box key">
<h4>Two words to use precisely in an answer</h4>
<p><strong>Marshalling</strong> is packing arguments into a message on the way out (step 2); <strong>unmarshalling</strong> is unpacking them on the way in (step 5). If the question asks for the "working mechanism", use these two words by name &mdash; they are the mechanism.</p>
</div>

<h3>2.1.2 Advantages and disadvantages</h3>

<p>The two columns are the same fact seen twice: RPC gives you a call that <em>looks</em> local over a mechanism that is not. Each benefit is bought with the matching cost &mdash; transparency is bought with marshalling, reusability with a wire format both ends must agree on &mdash; and the deck's list is short enough to be worth reproducing in an answer as it stands.</p>

<table class="comparison-table">
<thead>
<tr><th>Benefits</th><th>Disadvantages</th></tr>
</thead>
<tbody>
<tr><td>Despite being local, the called procedure can be executed in a <strong>different process and on a different machine</strong>.</td><td>Based only on the parameters <strong>call-by-value and call-by-reference</strong>, which is not always acceptable for a remote call.</td></tr>
<tr><td>Supports <strong>process and thread-oriented</strong> models.</td><td>Can be <strong>slower due to overheads</strong> &mdash; marshalling, the network round trip and the kernel calls at both ends.</td></tr>
<tr><td>Provides <strong>access transparency</strong> when the stub layer is complete.</td><td><strong>Non-flexible for hardware architectures</strong> &mdash; the marshalled representation must be agreed on both ends.</td></tr>
<tr><td><strong>Code reusability</strong>, and the same call can be used in a local and a distributed environment.</td><td></td></tr>
</tbody>
</table>

<p>Two of the disadvantages deserve a sentence each, because each one is the reason a later topic exists. The first is <strong>call-by-value and call-by-reference</strong>: both are local mechanisms, and a reference is an address in one address space, so sending it to another machine sends something meaningless. The repair is the <strong>remote object reference</strong> and the stub that turns the call into a message (2.2.1). The second is <strong>inflexibility about hardware and representation</strong>: both ends must agree on how the parameters are laid out, so the interface has to be expressed in something language-neutral &mdash; CORBA's IDL, or a data format such as JSON (2.4.3) &mdash; and a change on one side is a change on both. Read the same list against 2.1.1's ten steps and every disadvantage maps onto a step: this is what marshalling, the round trip and the kernel calls cost you.</p>

<h3>2.1.3 RPC issues &mdash; the five things that go wrong</h3>
<p>Because the caller and the provider of the procedure are in distant locations, normal functioning can be disrupted in five ways. These are the five to list first when a question says "discuss the problems of RPC":</p>

<table class="comparison-table">
<thead>
<tr><th>#</th><th>Fault</th><th>What the client observes</th><th>Mechanism that addresses it</th></tr>
</thead>
<tbody>
<tr><td>1</td><td>The client is <strong>unable to locate the server</strong></td><td>No route to the procedure at all &mdash; a binding failure, not a lost message.</td><td>A naming or binder service that maps a name to a current address.</td></tr>
<tr><td>2</td><td><strong>Lost request message</strong></td><td>The reply never arrives; the client cannot tell this from a slow server.</td><td>Retransmit the request after a timeout.</td></tr>
<tr><td>3</td><td><strong>Lost reply message</strong></td><td>The operation was in fact performed, but the client never learns the result.</td><td>Retransmit, or keep a history of results (see below).</td></tr>
<tr><td>4</td><td><strong>Server crash</strong> after receiving a request</td><td>The client cannot know whether the procedure ran before the crash.</td><td>Duplicate filtering and idempotent operation design.</td></tr>
<tr><td>5</td><td><strong>Client crash</strong> after sending a request</td><td>The server may compute a result nobody will ever collect &mdash; an <em>orphan</em> call.</td><td>Orphans are detected and discarded (see <em>last-of-many</em> semantics).</td></tr>
</tbody>
</table>

<p>Under these fault conditions, <strong>call semantics</strong> define when and how often a remote procedure may be executed. The deck's rule is that <strong>call semantics must be the same whether the procedure is implemented locally or remotely</strong> &mdash; otherwise the abstraction leaks and the program becomes untestable.</p>

<h3>2.1.4 Call semantics</h3>

<table class="comparison-table">
<thead>
<tr><th>Semantics</th><th>What is guaranteed</th><th>How it is achieved / why it fails</th></tr>
</thead>
<tbody>
<tr><td><strong>Exactly once</strong></td><td>The procedure executes once and only once, always.</td><td>The ideal, and <strong>hard to achieve in practice</strong>. It relies on time-outs, retransmissions, the same call identifier on every retransmission, and a cache associated with the callee that recognises a repeat of the same call.</td></tr>
<tr><td><strong>At most once</strong> (also called <em>maybe</em>)</td><td>The procedure executes once, or not at all. The client cannot tell which.</td><td>The RPC is requested only once and never retried, so no reply may mean no execution took place. Cheap, and honest about what it cannot know.</td></tr>
<tr><td><strong>At least once</strong></td><td>The procedure executes one or more times &mdash; definitely once if the client gets a reply.</td><td>The client keeps requesting the RPC until a valid response arrives. Safe only when repeating the operation is harmless.</td></tr>
<tr><td><strong>Last once</strong></td><td>The most recent call is the one whose result counts.</td><td>Based on time-outs: the request is retransmitted until the result of the execution is received.</td></tr>
<tr><td><strong>Last-of-many call</strong></td><td>The call is accepted only when the identifier matches the most recent call.</td><td>It <strong>neglects orphan calls</strong> &mdash; those whose caller has expired because its node crashed &mdash; and accepts only the newest.</td></tr>
</tbody>
</table>

<div class="concept-box warn">
<h4>The trade-off behind the table</h4>
<p>Every step down that table buys reliability of delivery at the cost of knowing less about how many times the work happened. <em>At least once</em> can execute twice; <em>at most once</em> can execute zero times. The engineering answer to the first is to make the operation <strong>idempotent</strong> &mdash; repeatable with the same effect &mdash; so that executing it twice is harmless.</p>
</div>

<h3>2.1.5 Providing a reliable request&ndash;reply protocol</h3>
<p>Underneath the semantics, three fault-tolerant measures are available, and the deck presents them as the three decisions a designer makes:</p>

<table class="comparison-table">
<thead>
<tr><th>Measure</th><th>The decision</th><th>The cost of choosing it</th></tr>
</thead>
<tbody>
<tr><td><strong>Retry request message</strong></td><td>Whether to retransmit the request message until either a reply is received or the server is assumed to have failed.</td><td>The server may execute the procedure more than once &mdash; the <em>at least once</em> hazard.</td></tr>
<tr><td><strong>Duplicate filtering</strong></td><td>When retransmissions are used, whether to filter out duplicate requests at the server.</td><td>The server must remember identifiers of requests it has seen, which costs state and time.</td></tr>
<tr><td><strong>Retransmission of results</strong></td><td>Whether to keep a <strong>history of result messages</strong> so that lost replies can be re-sent <em>without re-executing</em> the operation at the server.</td><td>The server must store results, and clients must accept that the retransmitted reply is the cached one.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s22-015.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s22-015.webp" alt="Providing reliable request-reply protocol" width="972" height="456" loading="lazy" decoding="async">
<figcaption><strong>slide 22</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx &mdash; Providing reliable request-reply protocol</figcaption>
</figure>
<!-- /dcc-fig -->
<p>The third is the fix for the most awkward of the five faults: a lost reply means the work <em>was</em> done, so re-executing the procedure to satisfy the client is exactly the wrong response. Keeping results lets the client be satisfied without the operation running twice.</p>

<h2>2.2 Remote Method Invocation (RMI)</h2>

<p>RMI is <strong>a communication mechanism among distributed objects in which method invocation between objects in different processes takes place</strong>, whether those processes are on the same machine or separated. Each process consists of a set of objects, and those objects may receive local invocations, remote invocations, or both. <strong>Objects that receive remote invocations are called remote objects.</strong></p>
<p>Where RPC invokes a procedure by name and deliberately drops the object reference from the request, RMI keeps the object: the caller holds a reference to an object that happens to live in another process, and calls a method on it. That difference is what forces the extra machinery below.</p>

<figure class="figure-wide figure-wrap">
<svg class="figure wide" viewBox="0 0 780 300" role="img" aria-label="Two processes, each holding objects. Object A in the client process holds a proxy for the remote object B in the server process; the request travels through the communication module and the remote reference module to the skeleton and dispatcher, which invoke the servant that implements B's remote interface.">
<defs><marker id="f2b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="flow-arrow-head"/></marker></defs>

<text class="flow-label" x="150" y="22" text-anchor="middle">Client process</text>
<text class="flow-label" x="630" y="22" text-anchor="middle">Server process</text>

<rect class="flow-box phase1" x="50" y="36" width="200" height="42" rx="9"/>
<text class="flow-text" x="150" y="62">Object A</text>
<rect class="flow-box phase2" x="50" y="90" width="200" height="42" rx="9"/>
<text class="flow-text" x="150" y="116">Proxy for B</text>
<rect class="flow-box phase4" x="50" y="186" width="200" height="42" rx="9"/>
<text class="flow-text" x="150" y="212">Communication module</text>
<rect class="flow-box phase4" x="50" y="240" width="200" height="36" rx="9"/>
<text class="flow-text" x="150" y="263">Remote reference module</text>

<rect class="flow-box phase1" x="530" y="36" width="200" height="42" rx="9"/>
<text class="flow-text" x="630" y="62">Servant (object B)</text>
<rect class="flow-box phase2" x="530" y="90" width="200" height="42" rx="9"/>
<text class="flow-text" x="630" y="116">Skeleton &amp; dispatcher</text>
<rect class="flow-box phase4" x="530" y="186" width="200" height="42" rx="9"/>
<text class="flow-text" x="630" y="212">Communication module</text>
<rect class="flow-box phase4" x="530" y="240" width="200" height="36" rx="9"/>
<text class="flow-text" x="630" y="263">Remote reference module</text>

<path class="flow-arrow" d="M150,78 V86" marker-end="url(#f2b)"/>
<path class="flow-arrow" d="M150,132 V182" marker-end="url(#f2b)"/>
<path class="flow-arrow" d="M630,132 V182" marker-end="url(#f2b)"/>
<path class="flow-arrow" d="M630,186 V82" marker-end="url(#f2b)"/>

<path class="flow-arrow" d="M254,204 H526" marker-end="url(#f2b)"/>
<text class="flow-label" x="390" y="196" text-anchor="middle">request</text>
<path class="flow-arrow" d="M526,244 H254" marker-end="url(#f2b)"/>
<text class="flow-label" x="390" y="288" text-anchor="middle">reply</text>

<text class="flow-label" x="390" y="150" text-anchor="middle">The proxy is what makes a remote invocation look local:</text>
<text class="flow-label" x="390" y="170" text-anchor="middle">it marshals, sends, receives and unmarshals.</text>
</svg>
<figcaption><strong>Fig 2.2 &mdash; The RMI software between application objects and the communication layer.</strong> Proxy, dispatcher and skeleton sit <em>between</em> the application-level objects and the communication and remote-reference modules. The deck's own slide 14 shows this as one column per process; the arrangement here is the same four roles, drawn so the request and reply path is readable.</figcaption>
</figure>
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s14-012.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s14-012.webp" alt="Implementation of RMI/Architecture" width="897" height="393" loading="lazy" decoding="async">
<figcaption><strong>slide 14</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx &mdash; Implementation of RMI/Architecture</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s14-013.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s14-013.webp" alt="Implementation of RMI/Architecture" width="1160" height="651" loading="lazy" decoding="async">
<figcaption><strong>slide 14</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx &mdash; Implementation of RMI/Architecture</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>2.2.1 What a remote invocation requires</h3>
<ul>
<li>Objects need to know the <strong>remote object reference</strong> of an object in another process in order to invoke its methods.</li>
<li>The <strong>remote interface</strong> specifies which methods of an object can be invoked remotely. Objects in other processes can invoke <em>only</em> the methods that belong to its remote interface &mdash; everything else is private to the process that holds the object.</li>
<li>An object that can receive remote invocations is a <strong>remote object</strong>, and the class that implements it usually also has to be usable by a local caller, so the implementation is separated from what is exposed.</li>
</ul>
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s13-011.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s13-011.webp" alt="Each process contains objects, some of which can receive remote invocations(B and F), others only local invocations(C,E and D) objects need to know the Remote object reference of a" width="1132" height="262" loading="lazy" decoding="async">
<figcaption><strong>slide 13</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx &mdash; Each process contains objects, some of which can receive remote invocations(B and F), others only local invocations(C,E and D) objects need to know the Remote object reference of a</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s18-014.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s18-014.webp" alt="Remote Object and its Remote Interface" width="1126" height="425" loading="lazy" decoding="async">
<figcaption><strong>slide 18</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx &mdash; Remote Object and its Remote Interface</figcaption>
</figure>
<!-- /dcc-fig -->
<p>Those three requirements are the vocabulary to answer an RMI question with, and the order they come in is the order of the problem. A caller can invoke a method remotely only if it holds a <strong>remote object reference</strong> for the object &mdash; which is the repaired version of the pointer that RPC cannot send (2.1.2). It can then invoke <em>only</em> the methods the <strong>remote interface</strong> exposes, so the interface is not documentation: it is the boundary the runtime enforces. In the deck's diagram of the two processes, B and F can receive remote invocations while C, D and E cannot, and nothing visible from the outside distinguishes them &mdash; only the interface does. That is why the class is written so that the implementation and the exposed part can be separated, and why a remote object can still be used by a local caller as an ordinary object.</p>
<h3>2.2.2 The RMI software &mdash; five roles to name</h3>
<p>This is the table to reproduce in an exam answer about RMI's architecture. Each row is a distinct role, and a question that says "explain the implementation of RMI" is asking for all five.</p>

<table class="comparison-table">
<thead>
<tr><th>Component</th><th>Responsibility</th></tr>
</thead>
<tbody>
<tr><td><strong>Proxy</strong></td><td>Makes remote invocation <em>transparent</em> to the client: it <strong>marshals arguments</strong>, forwards the request, receives the message and <strong>unmarshals results</strong>. From the client's side it behaves like the object itself.</td></tr>
<tr><td><strong>Dispatcher</strong></td><td>Handles the transfer of requests to the correct method: it receives requests, selects the correct method, and passes on the request message.</td></tr>
<tr><td><strong>Skeleton</strong></td><td>Implements the methods of the remote interface: it <strong>unmarshals arguments</strong> from the request, <strong>invokes the method of the remote object</strong>, and <strong>marshals the results</strong>.</td></tr>
<tr><td><strong>Remote reference module</strong></td><td>Responsible for the translation between local and remote object references, and keeps the <strong>remote object table</strong>. It holds an entry for each remote object held by the process and an entry for each local proxy, creates a remote object reference when one arrives, and looks entries up when a remote object reference must be passed &mdash; creating a new reference and adding an entry if necessary.</td></tr>
<tr><td><strong>Binder</strong></td><td>A separate service maintaining a table of mappings from <strong>textual names to remote object references</strong>. Servers register objects with it; clients look references up in it.</td></tr>
</tbody>
</table>

<p>Two further pieces of the server side are worth a sentence each. <strong>Server threads</strong> are implemented in order to handle a call by creating a new thread for each remote invocation; a server with several remote objects might also allocate separate threads to handle each object, so that a slow call on one object does not block the other.</p>

<p>The server and client programs divide the work as the deck describes it. The <strong>server</strong> contains classes for dispatchers, skeletons and remote objects, an initialisation section that creates some remote objects, and code registering those remote objects with the binder. The <strong>client</strong> contains classes for proxies of all the remote objects and the binder lookup. One practical constraint follows from this: <strong>a client cannot create remote objects by directly calling constructors, so remote object creation is done through factory methods.</strong></p>

<h3>2.2.3 The remote interface &mdash; how it is declared</h3>
<p>The remote interface is the boundary of what can be invoked from outside. Two implementations are named in the deck, and the contrast is examinable:</p>

<table class="comparison-table">
<thead>
<tr><th></th><th>CORBA</th><th>Java RMI</th></tr>
</thead>
<tbody>
<tr><td><strong>How the remote interface is specified</strong></td><td>An <strong>IDL</strong> (Interface Definition Language), which is language-neutral &mdash; the same interface can then be implemented in C++, Java or anything else.</td><td>The interface is extended with the <strong>Remote</strong> keyword: <code>public interface HelloInterface extends Remote</code>.</td></tr>
<tr><td><strong>Invocation semantics used</strong></td><td>At-most-once, <em>and</em> maybe semantics for methods that do not return a result.</td><td>At-most-once.</td></tr>
</tbody>
</table>

<p>The contrast worth writing out is not which mechanism is better but <em>what each one buys</em>. An <strong>IDL</strong> is language-neutral: the interface is written once and implementations may be in C++ on one machine and Java on another, which is Unit 1.3's heterogeneity answer applied to objects &mdash; and it is why CORBA is the middleware example in 4.3.2. Java RMI trades that neutrality for convenience: the interface is ordinary Java with the <code>Remote</code> keyword, and in exchange both ends must be Java, which is why it appears here as a language's own mechanism and in 4.3.3 as a middleware family with that same limitation. The invocation-semantics row is the second half of the same trade. CORBA permits <strong>maybe</strong> semantics for a method that returns no result: the client does not wait for an acknowledgement, so it genuinely cannot know whether the call happened &mdash; which is honest rather than careless, because there is no result to bring back anyway.</p>

<h3>2.2.4 Design issues in RMI</h3>
<p>RMI shares RPC's design issues in three respects: <strong>programming with interfaces</strong>, <strong>call semantics</strong>, and the <strong>level of transparency</strong>. Beyond those, two issues are the ones it must deal with in making a remote invocation:</p>
<ol>
<li><strong>Number of times the method is invoked in response to a single remote invocation</strong> &mdash; the invocation semantics.</li>
<li><strong>Level of location transparency</strong> &mdash; how much of the remoteness is hidden.</li>
</ol>

<p>On the first, the semantics are the same family as RPC's, with the same failure analysis attached:</p>

<table class="comparison-table">
<thead>
<tr><th>Invocation semantics</th><th>Guarantee and failure types</th></tr>
</thead>
<tbody>
<tr><td><strong>Exactly once</strong></td><td>Every method is executed exactly once &mdash; the ideal situation.</td></tr>
<tr><td><strong>Maybe</strong></td><td>The invoker <strong>cannot determine whether or not the remote method has been executed</strong>. <em>Omission failures</em> arise if the invocation or the result message is lost; <em>crash failures</em> when the server containing the remote object fails. Useful for applications where an occasional failed invocation is acceptable.</td></tr>
<tr><td><strong>At-least-once</strong></td><td>The invoker either receives a result (so the method was executed at least once) or an exception. Retransmitting the request <strong>masks omission failures</strong>; crash failures still occur when the server fails. The hazard is <strong>arbitrary failure</strong> &mdash; the remote method is invoked more than once, so wrong values may be stored or returned &mdash; and the solution is to design the operations as <strong>idempotent</strong>. Useful if the objects in a server can be designed to have idempotent operations.</td></tr>
<tr><td><strong>At-most-once</strong></td><td>The invoker either receives a result (and knows the method executed at most once) or an exception. <strong>All fault-tolerance methods are used:</strong> omission failures are eliminated by retransmitting the request, and arbitrary failures are prevented by ensuring no method is executed more than once.</td></tr>
</tbody>
</table>

<div class="concept-box tip">
<h4>The one line that answers "which system uses which semantics?"</h4>
<p><strong>Java RMI and CORBA use at-most-once semantics; CORBA also uses maybe semantics for methods that do not return results; SUNRPC provides at-least-once semantics.</strong> This is a favourite fill-in-the-blank, and it is worth memorising as a set rather than learning each system separately.</p>
</div>

<h3>2.2.5 Location transparency, and why it causes failure and latency</h3>
<p>Attempting full location transparency causes both failure and latency, because of <strong>syntactical differences in behaviour between a remote invocation and a local one</strong>. Two solutions are named:</p>
<ul>
<li><strong>Exceptions and exception handling are needed</strong> &mdash; a remote call can fail in ways a local one cannot, so the language's error mechanism has to carry that.</li>
<li><strong>Different invocation semantics can be employed</strong> &mdash; accepting that a remote call is not a local call and choosing a weaker guarantee deliberately, rather than pretending the difference does not exist.</li>
</ul>

<p>Keep the two kinds of transparency apart, because an answer that mixes them reads as if the student has not noticed the difference. <strong>Access transparency</strong> is that the same operation is used on a remote object as on a local one &mdash; RPC delivers this one, and it is what "looks like a local call" means. <strong>Location transparency</strong> is the stronger claim that the caller does not know <em>where</em> the object is, and that is the claim that fails in practice: a network's latency and its failure modes are part of the interface whether the designer admits it or not, so a call dressed up as a local one leaves the programmer no way to handle what actually happens. The two named solutions are opposite in spirit and both are defensible: carry the difference into the language, so that every remote call can raise an exception and failure becomes part of the signature; or accept the difference in the semantics and choose a weaker guarantee knowing what you gave up (the at-most-once and maybe semantics of 2.1.1 and 2.2.3). Real middleware takes the second road, which is why call semantics are a design decision rather than a detail.</p>

<h3>2.2.6 Java RMI case study</h3>
<p>Java RMI <strong>extends the Java object model to provide support for distributed objects</strong>: it lets objects invoke methods on remote objects using <strong>the same syntax as for local invocations</strong>, and type checking applies equally to remote and local calls. Its costs are stated plainly in the deck: it is a <strong>single-language system</strong>, and the programmer of a remote object must consider that object's behaviour in a <strong>concurrent environment</strong>.</p>

<p>Four files make a Java RMI application, and the deck's Hello example is the one to reproduce:</p>

<table class="comparison-table">
<thead>
<tr><th>File</th><th>Role</th><th>From the deck's Hello example</th></tr>
</thead>
<tbody>
<tr><td><code>HelloInterface.java</code></td><td>The <strong>remote interface</strong> &mdash; defines the remote interface provided by the service. Usually a short statement specifying the service function.</td><td><code>public interface HelloInterface extends Remote</code> with <code>public String say(String msg) throws RemoteException;</code></td></tr>
<tr><td><code>Hello.java</code></td><td>The <strong>remote object</strong> implementing the remote service: a constructor and the required functions.</td><td><code>public class Hello extends UnicastRemoteObject implements HelloInterface</code> &mdash; <code>say</code> returns the input string reversed plus the server's own message.</td></tr>
<tr><td><code>HelloClient.java</code></td><td>The <strong>client</strong> that invokes the remote method.</td><td><code>HelloInterface hello = (HelloInterface) Naming.lookup(path);</code> then <code>hello.say(args[i])</code> &mdash; called like a local object.</td></tr>
<tr><td><code>HelloServer.java</code></td><td>The <strong>server</strong>: offers the remote service, installs a security manager, and contacts the <code>rmiregistry</code> with an instance of the service under the name of the remote object.</td><td><code>System.setSecurityManager(new RMISecurityManager());</code> then <code>Naming.rebind("Hello", new Hello("Hello, world!"));</code></td></tr>
</tbody>
</table>

<p>"An interface is the skeleton for a public class" is the deck's own gloss on why the interface file is so short, and it is the clearest way to explain the split: the interface says <em>what can be called</em>, the object says <em>what happens</em>.</p>

<h2>2.3 Message Passing and Serialization</h2>

<p>RPC and RMI hide the message. This sub-topic is about the two things underneath: the <strong>message-passing model</strong>, in which the programmer writes the sends and receives, and <strong>serialization</strong>, which is what makes it possible to put a structured value in a message at all.</p>

<h3>2.3.1 Shared memory versus distributed memory</h3>
<p>The comparison that motivates message passing, exactly as the deck sets it up:</p>

<table class="comparison-table">
<thead>
<tr><th></th><th>Shared memory systems</th><th>Distributed memory systems</th></tr>
</thead>
<tbody>
<tr><td><strong>Model</strong></td><td>Processing elements (PE0&hellip;PEn) all see one data area.</td><td>Each PE has its own memory (Mem0&hellip;MemN) and they meet only on a NETWORK.</td></tr>
<tr><td><strong>Advantages</strong></td><td>Easy to parallelize, and all data is available nearby.</td><td>Locality of data is explicit, and it is cheap to build.</td></tr>
<tr><td><strong>Limitations</strong></td><td>Only practical up to certain system sizes &mdash; all of them must share one memory.</td><td>Data must be moved by explicit messages, so the programmer must think about what goes where.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s30-016.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s30-016.webp" alt="Message Passing" width="1097" height="587" loading="lazy" decoding="async">
<figcaption><strong>slide 30</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx &mdash; Message Passing</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s31-017.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s31-017.webp" alt="Diagram from LectureMain_Ch_2_Communication_in_DS.pptx, slide 31" width="1063" height="567" loading="lazy" decoding="async">
<figcaption><strong>slide 31</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>The last two rows are a trade, not a ranking, and that is the examinable point. A shared-memory system is easier to program because everything is <em>nearby</em> &mdash; a data structure can simply be read and written &mdash; but it stops working past the size at which all processing elements can still reach one memory. A distributed-memory system scales by construction and pays for that by making <strong>locality explicit</strong>: data moves only when a message says so, so the programmer decides what moves, when and how much. That single difference &mdash; an implicit address space against an explicit one &mdash; is what the rest of 2.3 is about, and it is why message passing counts as a programming model and not merely as a mechanism.</p>
<h3>2.3.2 The message-passing model</h3>
<ul>
<li><strong>Work unit:</strong> processes.</li>
<li><strong>Data units:</strong> decomposed, so that each process has <em>its own</em> data unit. There is <strong>no shared data</strong>.</li>
<li><strong>Coordination:</strong> by exchanging <em>messages</em> through <code>send</code> and <code>recv</code> calls. The analogy the deck uses is <strong>mail</strong>.</li>
<li><strong>Typical clusters today:</strong> an Ethernet or a more sophisticated network card and an interconnect; messages are sent as <strong>packets over the network</strong>. The <strong>Network Interface Card (NIC)</strong> is the example of the co-processor that handles this.</li>
</ul>
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s32-018.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s32-018.webp" alt="Diagram from LectureMain_Ch_2_Communication_in_DS.pptx, slide 32" width="1116" height="392" loading="lazy" decoding="async">
<figcaption><strong>slide 32</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s32-019.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s32-019.webp" alt="Diagram from LectureMain_Ch_2_Communication_in_DS.pptx, slide 32" width="951" height="363" loading="lazy" decoding="async">
<figcaption><strong>slide 32</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>The basic calls of a hypothetical message-passing system define the model: <code>send(int proc, int tag, int size, char *buf)</code> and a matching receive. Two details in the deck matter for exams: <code>recv</code> may <strong>return the actual number of bytes received</strong> in some systems, and <strong><code>tag</code> and <code>proc</code> may be wildcarded in a receive</strong> &mdash; <code>recv(ANY, ANY, 1000, &amp;buf)</code> accepts a message from any source with any tag.</p>
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s33-020.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s33-020.webp" alt="Message passing in the deck&#x27;s diagram: send copies the data out of the sender&#x27;s buffer and receive delivers it at the destination process, drawn as PE0 to PE1." width="1038" height="542" loading="lazy" decoding="async">
<figcaption><strong>slide 33</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx &mdash; Message passing in the deck&#x27;s diagram: send copies the data out of the sender&#x27;s buffer and receive delivers it at the destination process, drawn as PE0 to PE1.</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s34-021.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s34-021.webp" alt="Diagram from LectureMain_Ch_2_Communication_in_DS.pptx, slide 34" width="1032" height="469" loading="lazy" decoding="async">
<figcaption><strong>slide 34</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>Two consequences of that signature are worth naming. First, the model is <strong>explicit about the data that moves</strong>: the call names a buffer and a size, so a program's correctness depends on both sides agreeing about layout in a way a local function call never has to &mdash; the programmer marshals, or the library does. Second, the <strong>wildcarded receive</strong> is what makes a process able to act as a server: <code>recv(ANY, ANY, ...)</code> takes work from whoever asks, while a sender that names a specific <code>proc</code> and <code>tag</code> is addressing one peer. A pairing of a specific send with a wildcarded receive is the message-passing version of a
request&ndash;reply interaction (2.1), and the tag is what lets one channel carry several conversations &mdash; which is why the envelope below carries it.</p>
<h3>2.3.3 Collective calls and SPMD</h3>
<p>Message passing is often &mdash; but not always &mdash; used for <strong>SPMD</strong> style programming: <em>Single Program, Multiple Data</em>. All processors execute essentially the same program and the same steps, <strong>but not in lockstep</strong>. On top of the pairwise sends, SPMD programs need <strong>collective calls</strong>: global reductions such as max or sum, and broadcast (<code>syncBroadcast(whoAmI, dataSize, dataBuffer)</code>), where <code>whoAmI</code> identifies sender or receiver.</p>
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s35-022.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s35-022.webp" alt="Diagram from LectureMain_Ch_2_Communication_in_DS.pptx, slide 35" width="1068" height="517" loading="lazy" decoding="async">
<figcaption><strong>slide 35</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>Two properties of SPMD are easy to get wrong in an answer. It is <em>one</em> program, not one program per processor: the same source runs everywhere, and it is the processor's own identity &mdash; "who am I?" &mdash; that makes each copy behave differently, which is exactly why the collective call above takes <code>whoAmI</code> as an argument. And the copies are <strong>not in lockstep</strong>: there is no global step, so a collective call is the only point at which the processes agree, which makes it a synchronisation as well as a movement of data. That is also the honest limit of the model: a broadcast or a reduction is a point every process has to arrive at, so the slowest participant sets the pace, and a program that relies on many of them spends its life waiting.</p>
<h3>2.3.4 MPI &mdash; the real message-passing system</h3>
<p>The deck moves from the hypothetical interface to MPI (Message Passing Interface). Two calls bracket every MPI program: <strong><code>MPI_Init(int argc, char **argv)</code></strong> initialises the MPI library, and <strong><code>MPI_Finalize()</code></strong> terminates its use; <strong>all MPI calls must occur between these two</strong>. A useful subset of six functions is enough to write many programs:</p>
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s36-023.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s36-023.webp" alt="Basic MPI sending and receiving messages, from the deck: each process names its peer and a tag, and the message is matched by that pair." width="742" height="260" loading="lazy" decoding="async">
<figcaption><strong>slide 36</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx &mdash; Basic MPI sending and receiving messages, from the deck: each process names its peer and a tag, and the message is matched by that pair.</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s37-024.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s37-024.webp" alt="Diagram from LectureMain_Ch_2_Communication_in_DS.pptx, slide 37" width="870" height="364" loading="lazy" decoding="async">
<figcaption><strong>slide 37</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s37-025.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s37-025.webp" alt="Diagram from LectureMain_Ch_2_Communication_in_DS.pptx, slide 37" width="852" height="392" loading="lazy" decoding="async">
<figcaption><strong>slide 37</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<table class="comparison-table">
<thead>
<tr><th>Function</th><th>Arguments and meaning</th></tr>
</thead>
<tbody>
<tr><td><code>MPI_Init</code> / <code>MPI_Finalize</code></td><td>Initialise and shut down the library; every other call lies between them.</td></tr>
<tr><td><code>MPI_Comm_size(comm, &amp;size)</code></td><td>Determines <strong>the number of processes</strong>.</td></tr>
<tr><td><code>MPI_Comm_rank(comm, &amp;pid)</code></td><td><code>pid</code> is <strong>the process identifier of the caller</strong> &mdash; how a process knows which part of the work it owns.</td></tr>
<tr><td><code>MPI_Send(buf, count, datatype, dest, tag, comm)</code></td><td><code>buf</code> is the address of the send buffer, <code>count</code> the number of elements (&times; <code>sizeof(datatype)</code>), <code>datatype</code> the type of the elements, <code>dest</code> the destination process id, <code>tag</code> the message tag, <code>comm</code> the communicator.</td></tr>
<tr><td><code>MPI_Recv(buf, count, datatype, source, tag, comm, &amp;status)</code></td><td>Mirror image: <code>count</code> is the <em>size of the receive buffer</em> in elements, <code>source</code> is a process id or <code>MPI_ANY_SOURCE</code>, and <code>status</code> reports what actually arrived.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s38-026.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s38-026.webp" alt="Diagram from LectureMain_Ch_2_Communication_in_DS.pptx, slide 38" width="726" height="299" loading="lazy" decoding="async">
<figcaption><strong>slide 38</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s38-027.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s38-027.webp" alt="Diagram from LectureMain_Ch_2_Communication_in_DS.pptx, slide 38" width="1100" height="522" loading="lazy" decoding="async">
<figcaption><strong>slide 38</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s39-028.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s39-028.webp" alt="Diagram from LectureMain_Ch_2_Communication_in_DS.pptx, slide 39" width="894" height="473" loading="lazy" decoding="async">
<figcaption><strong>slide 39</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>2.3.5 What implementing message passing actually costs</h3>
<p>A send and a receive involve copying data from the user's data space on the source processor to the user's data space on the destination, and the MPI library sits in between to packetize it. The deck's list of issues is the honest part of the model:</p>
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s41-030.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s41-030.webp" alt="Diagram from LectureMain_Ch_2_Communication_in_DS.pptx, slide 41" width="832" height="490" loading="lazy" decoding="async">
<figcaption><strong>slide 41</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s41-031.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s41-031.webp" alt="Diagram from LectureMain_Ch_2_Communication_in_DS.pptx, slide 41" width="757" height="505" loading="lazy" decoding="async">
<figcaption><strong>slide 41</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<ul>
<li><strong>Data copying cost</strong> &mdash; if you copy into MPI buffers at both source and destination, you pay for the copy twice.</li>
<li><strong>Buffer availability and allocation</strong> &mdash; a send may block if no buffer is free at the receiver.</li>
<li><strong>Packetization</strong> &mdash; who pays attention to incoming packets, and where do they go?</li>
<li><strong>Tag matching</strong> &mdash; an arriving message must be matched to the receive that wants it.</li>
<li><strong>Progress engine</strong> &mdash; the machinery that keeps moving messages while the application is doing something else.</li>
</ul>
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s40-029.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s40-029.webp" alt="Diagram from LectureMain_Ch_2_Communication_in_DS.pptx, slide 40" width="730" height="221" loading="lazy" decoding="async">
<figcaption><strong>slide 40</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s42-032.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s42-032.webp" alt="Diagram from LectureMain_Ch_2_Communication_in_DS.pptx, slide 42" width="944" height="511" loading="lazy" decoding="async">
<figcaption><strong>slide 42</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s42-033.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s42-033.webp" alt="Diagram from LectureMain_Ch_2_Communication_in_DS.pptx, slide 42" width="1070" height="272" loading="lazy" decoding="async">
<figcaption><strong>slide 42</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>Underneath, the transfer requires <strong>data transfer plus synchronisation</strong>: the receiver may have to answer <em>"may I send?"</em> with <em>"yes"</em> before the data moves. This <strong>requires the cooperation of sender and receiver, and that cooperation is not always apparent in the code</strong> &mdash; a fair summary of why message-passing programs are hard to debug.</p>
<!-- dcc-fig:ch2/messagepassing-refnote2-p07.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/messagepassing-refnote2-p07.webp" alt="Communication (II)" width="1240" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 7</strong> &middot; MessagePassing_refnote2.pdf &mdash; Communication (II)</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>2.3.6 Messaging protocols: short, eager and rendezvous</h3>
<p>A message consists of an <strong>envelope (header)</strong> and data. The envelope contains the <strong>tag, communicator, length, source information</strong>, plus implementation-specific private data. MPI implementations often use <strong>different protocols for different messages</strong>, to trade performance against buffer memory:</p>
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s43-034.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s43-034.webp" alt="Diagram from LectureMain_Ch_2_Communication_in_DS.pptx, slide 43" width="1082" height="545" loading="lazy" decoding="async">
<figcaption><strong>slide 43</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<table class="comparison-table">
<thead>
<tr><th>Protocol</th><th>How it works</th><th>Why choose it</th></tr>
</thead>
<tbody>
<tr><td><strong>Short</strong></td><td>The whole message fits in an internal buffer and is sent in one piece.</td><td>Lowest overhead for small messages.</td></tr>
<tr><td><strong>Eager</strong></td><td>The message is sent as soon as it is available, whether or not the receiver is ready &mdash; the sender does not wait.</td><td>Best latency, at the cost of buffering at the receiver.</td></tr>
<tr><td><strong>Rendezvous</strong></td><td>The <strong>header is sent first</strong> and <strong>the message is not sent until the destination sends an ok-to-send reply</strong>.</td><td>No large buffer needed, and no risk of overrunning the receiver &mdash; at the cost of a round trip before the data moves.</td></tr>
</tbody>
</table>

<p>Read the three protocols as one trade seen at three settings: <strong>how much buffer memory you spend to avoid waiting</strong>. A short message is the easy case, and both remaining protocols are about messages that do not fit. Eager sending keeps latency low by shoving the data at a receiver that may not have asked for it yet, so the receiver has to hold it somewhere in the meantime; rendezvous removes that requirement by asking first &mdash; the header goes, the receiver answers "ok to send", and only then does the data follow. The round trip is the price of never overrunning anyone. The last row of the table is the reason this is in the syllabus at all: <strong>one implementation uses all three</strong>, choosing per message, which is the general lesson of the course that a single design point is rarely the right answer.</p>

<h3>2.3.7 Persistence and synchronicity &mdash; from the reference notes</h3>
<p>The pages reproduced in this section are the reference note's own figures for the material, and they are worth reading in this order: the <strong>post office and the pony express</strong>, which is the note's illustration of what it means for a message to be stored and forwarded rather than discarded; the <strong>temporal relationships between data items</strong>, which is the idea that correct interpretation depends on when items arrived; the <strong>token bucket</strong>, the standard picture of a stream being paced; a <strong>broker with conversion rules</strong> between a source and a destination client, which is messaging middleware from Unit 4.3.4 drawn early; and the <strong>interleaving of two streams</strong>, where a receiver reads two audio units for every video unit &mdash; the concrete case of why synchronicity has to be specified rather than assumed. The note's MPI primitives page sits among them as the message-passing API most of these models are described in.</p>
<!-- dcc-fig:ch2/messagepassing-refnote2-p08.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/messagepassing-refnote2-p08.webp" alt="Communication (II)" width="1240" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 8</strong> &middot; MessagePassing_refnote2.pdf &mdash; Communication (II)</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/messagepassing-refnote2-p11.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/messagepassing-refnote2-p11.webp" alt="Communication (II)" width="1240" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 11</strong> &middot; MessagePassing_refnote2.pdf &mdash; Communication (II)</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/messagepassing-refnote2-p13.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/messagepassing-refnote2-p13.webp" alt="Communication (II)" width="1240" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 13</strong> &middot; MessagePassing_refnote2.pdf &mdash; Communication (II)</figcaption>
</figure>
<!-- /dcc-fig -->
<p>The <em>Communication (II)</em> reference note adds the vocabulary that the class deck asserts without naming, and it is the pair of definitions most likely to be asked as a short question. The assumption behind it: applications run on <strong>hosts</strong>, each host is connected to one <strong>communication server</strong>, and buffers may be placed either on the hosts or in the communication servers of the underlying network &mdash; an e-mail system is the example.</p>
<table class="comparison-table">
<thead>
<tr><th>Dimension</th><th>Transient</th><th>Persistent</th></tr>
</thead>
<tbody>
<tr><td><strong>Persistence</strong> &mdash; how long a message survives</td><td>The message is <strong>discarded by a communication server as soon as it cannot be delivered</strong> at the next server or at the receiver. If the receiver is down, the message is lost.</td><td>The message is <strong>stored at a communication server as long as it takes to deliver it</strong> at the receiver, however long that is. The Pony Express is the deck's illustration: mail is stored, sorted and sent on when a pony and rider are available.</td></tr>
<tr><td><strong>Synchronicity</strong> &mdash; what the sender waits for</td><td colspan="2"><strong>Asynchronous:</strong> the sender continues immediately after it has submitted its message for transmission. <strong>Synchronous:</strong> the sender is blocked until its message is stored in a local buffer at the receiving host, or actually delivered to the receiver.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch2/messagepassing-refnote2-p03.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/messagepassing-refnote2-p03.webp" alt="Communication (II)" width="1240" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 3</strong> &middot; MessagePassing_refnote2.pdf &mdash; Communication (II)</figcaption>
</figure>
<!-- /dcc-fig -->
<p>Client/server computing is generally based on a model of <strong>synchronous</strong> communication: the client and server must both be active at the time of communication, the client issues a request and blocks until a reply is received, and the server essentially waits for incoming requests and processes them. Its drawbacks, as the note states them: <strong>the client cannot do any other work while waiting for a reply</strong>, <strong>failures have to be dealt with immediately</strong> because the client is waiting, and <strong>in many cases the model is simply not appropriate</strong> &mdash; mail and news being the usual examples.</p>
<!-- dcc-fig:ch2/messagepassing-refnote2-p02.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/messagepassing-refnote2-p02.webp" alt="Communication (II)" width="1240" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 2</strong> &middot; MessagePassing_refnote2.pdf &mdash; Communication (II)</figcaption>
</figure>
<!-- /dcc-fig -->
<p>The message-oriented answer to those drawbacks is a <strong>messaging interface</strong> in which <em>queued messages</em> are sent among processes, the <strong>sender is not stopped waiting for an immediate reply</strong>, and <strong>fault tolerance is often ensured by middleware</strong> rather than by the application. That is the design that persistent asynchronous communication makes possible.</p>
<!-- dcc-fig:ch2/messagepassing-refnote2-p06.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/messagepassing-refnote2-p06.webp" alt="Communication (II)" width="1240" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 6</strong> &middot; MessagePassing_refnote2.pdf &mdash; Communication (II)</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/messagepassing-refnote2-p14.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/messagepassing-refnote2-p14.webp" alt="Communication (II)" width="1240" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 14</strong> &middot; MessagePassing_refnote2.pdf &mdash; Communication (II)</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>2.3.8 Serialization</h3>
<p>Every mechanism in this unit eventually has to put a structured value &mdash; a struct, an object, an array of floats &mdash; into a byte stream and reconstruct it at the other end. The deck names the outbound half of this <strong>marshalling</strong> and requires it at step 2 of Fig 2.1 for the arguments, and again on the server side for the result.</p>

<table class="comparison-table">
<thead>
<tr><th>Term</th><th>Meaning</th><th>Where it appears</th></tr>
</thead>
<tbody>
<tr><td><strong>Marshalling</strong></td><td>Packaging arguments (or a result) into a message suitable for transmission.</td><td>Client stub step 2; server stub step 7.</td></tr>
<tr><td><strong>Unmarshalling</strong></td><td>Unpacking the message back into parameters or a return value.</td><td>Server stub step 5; client stub step 10.</td></tr>
<tr><td><strong>Serialization</strong></td><td>The general problem of converting an object or data structure into a form that can be stored or transmitted and reconstructed later &mdash; marshalling is serialization for the specific purpose of a call.</td><td>Java's socket example in the deck passes whole <code>Message</code> objects as serialized objects through <code>ObjectOutputStream</code>.</td></tr>
<tr><td><strong>Representation mismatch</strong></td><td>Two machines may disagree on how a value is laid out &mdash; byte order, integer width, floating-point format &mdash; so the serialized form has to be agreed.</td><td>The reason RPC's <em>non-flexible for hardware architectures</em> disadvantage exists, and why an IDL matters.</td></tr>
</tbody>
</table>

<div class="concept-box key">
<h4>Why call-by-reference is the problem</h4>
<p>RPC's disadvantage list includes that it works on <strong>call-by-value and call-by-reference parameters only, which is not always acceptable</strong>. The reason is serialization: a value can be copied into a message, but a <em>reference</em> means a pointer into one address space, and a pointer means nothing in another. Passing an object remotely therefore means either copying it (value) or passing a reference that the <em>remote reference module</em> must be able to resolve &mdash; which is precisely the machinery in 2.2.</p>
</div>

<h2>2.4 Sockets and Web Services (REST &amp; SOAP)</h2>

<h3>2.4.1 Sockets</h3>
<p>The pages below are the deck's socket material as it builds up: the client and server threads with their endpoint sockets and ports, the <code>MPI</code> sending-and-receiving page that shows the message-passing primitives underneath the same idea, the client thread's local I/O port, the <code>XTI</code> transport interface as the alternative to sockets on other systems, and then the Java TCP classes in the order the deck presents them &mdash; <code>Socket</code> and <code>ServerSocket</code>, then a complete server example. Read them as one sequence: what a socket is, then what its two ends contain, then what a program that uses it looks like.</p>
<!-- dcc-fig:ch2/messagepassing-refnote2-p04.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/messagepassing-refnote2-p04.webp" alt="Communication (II)" width="1240" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 4</strong> &middot; MessagePassing_refnote2.pdf &mdash; Communication (II)</figcaption>
</figure>
<!-- /dcc-fig -->
<p>Sockets are the low-level primitive under everything above. The deck describes them as follows: <strong>communication channels are formed across a communications network with help from the operating system</strong>, each thread creates an <strong>endpoint object</strong> representing its end of the channel, and messages pass between the endpoints, "across the channel".</p>
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s44-035.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s44-035.webp" alt="Sockets" width="902" height="557" loading="lazy" decoding="async">
<figcaption><strong>slide 44</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx &mdash; Sockets</figcaption>
</figure>
<!-- /dcc-fig -->
<ul>
<li>The <strong>client thread's socket</strong> specifies a local I/O port to be used for sending messages (or the port can be chosen by the operating system), and also the <strong>address of the destination machine</strong> and the <strong>port number expected to be bound to the server thread's socket</strong>.</li>
<li>The <strong>server's socket</strong> specifies a local I/O port for receiving messages. Messages can be received from <strong>any client that knows both the server's machine address and the port number bound to the server's socket</strong>.</li>
<li>The <strong>client issues a request to the server to form a connection</strong> between the two sockets.</li>
<li>Once the <strong>server accepts</strong> the connection request, messages can be passed in <strong>either direction</strong> across the channel.</li>
</ul>
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s45-036.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s45-036.webp" alt="Diagram from LectureMain_Ch_2_Communication_in_DS.pptx, slide 45" width="754" height="411" loading="lazy" decoding="async">
<figcaption><strong>slide 45</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>The Java TCP implementation is the concrete case in the deck, and it maps one-to-one onto those four steps: <code>Socket</code> and <code>ServerSocket</code> are the two classes. On the client, <code>new Socket(host, serverPort)</code> creates a socket and requests a connection to the host, throwing <code>IOException</code> if it cannot connect; then an <code>InputStream</code> and an <code>OutputStream</code> are obtained from the socket, so that reading and writing look <strong>like file I/O</strong> &mdash; <code>toServer.println("Hello")</code> and <code>fromServer.readLine()</code>. On the server, <code>new ServerSocket(serverPort)</code> is created once and then <strong><code>accept()</code> waits until a client requests a connection and returns a <code>Socket</code> connecting that client to the server</strong>; the server gets its streams, communicates, and then the connection is closed and it waits for the next request. A server can create a separate thread to handle each client's requests, by starting a <code>clientHandler</code> thread on the returned socket.</p>
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s46-037.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s46-037.webp" alt="Diagram from LectureMain_Ch_2_Communication_in_DS.pptx, slide 46" width="675" height="833" loading="lazy" decoding="async">
<figcaption><strong>slide 46</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s47-038.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s47-038.webp" alt="Diagram from LectureMain_Ch_2_Communication_in_DS.pptx, slide 47" width="1409" height="794" loading="lazy" decoding="async">
<figcaption><strong>slide 47</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/lecturemain-ch-2-communication-in-ds-s48-039.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/lecturemain-ch-2-communication-in-ds-s48-039.webp" alt="Diagram from LectureMain_Ch_2_Communication_in_DS.pptx, slide 48" width="631" height="559" loading="lazy" decoding="async">
<figcaption><strong>slide 48</strong> &middot; LectureMain_Ch_2_Communication_in_DS.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<div class="concept-box warn">
<h4>Blocking is the operational fact to remember</h4>
<p>A read on the input stream associated with a socket <strong>normally blocks</strong>. Setting <code>socket.setSoTimeout(1000)</code> gives a one-second timeout, after which a <code>SocketTimeoutException</code> is raised <strong>and the socket is still valid</strong>. That "still valid" clause is the useful detail: a timeout tells you the peer did not answer in time, not that the channel is broken.</p>
</div>

<h3>2.4.2 Why web services exist</h3>
<p>The Web Services deck states the problem before the solution, and the problem is the reason the solution is shaped as it is: <strong>how do you share data between devices in a network</strong> when the clients, the database, and the servers sit behind firewalls, routers and switches, with security and compatibility constraints between them? A <strong>direct connection between the database and the clients is normally not possible</strong> over the Internet because of firewalls and the risk of attack. A direct connection inside a local network behind the firewall is normally fine &mdash; but not over the Internet.</p>
<!-- dcc-fig:ch2/rest-soap-webservices-lecture-p01.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/rest-soap-webservices-lecture-p01.webp" alt="Diagram from REST_SOAP_webservices_Lecture.pdf, page 1" width="1241" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 1</strong> &middot; REST_SOAP_webservices_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/rest-soap-webservices-lecture-p02.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/rest-soap-webservices-lecture-p02.webp" alt="Diagram from REST_SOAP_webservices_Lecture.pdf, page 2" width="1241" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 2</strong> &middot; REST_SOAP_webservices_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/rest-soap-webservices-lecture-p04.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/rest-soap-webservices-lecture-p04.webp" alt="Diagram from REST_SOAP_webservices_Lecture.pdf, page 4" width="1241" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 4</strong> &middot; REST_SOAP_webservices_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<p>The solution is a <strong>web service</strong>: a standard way to get data over a network using <strong>standard web protocols</strong>, chiefly <strong>HTTP</strong>, which is supported by every browser, server and most programming languages. It is not that HTTP is the best possible transport; it is that <strong>HTTP is what a firewall will let through</strong>. Formally, a <strong>web service is a method of communication between two devices over the World Wide Web</strong>, with the standards defined by the <strong>W3C</strong>. Its properties, as listed: it is an <strong>API</strong>; it is <strong>cross-platform</strong>; it can be implemented and used in most programming languages (C#/ASP.NET, PHP, LabVIEW, Objective-C, Java); and it uses standard web technology &mdash; HTTP, REST, SOAP, XML, WSDL, JSON.</p>
<!-- dcc-fig:ch2/rest-soap-webservices-lecture-p03.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/rest-soap-webservices-lecture-p03.webp" alt="Diagram from REST_SOAP_webservices_Lecture.pdf, page 3" width="1241" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 3</strong> &middot; REST_SOAP_webservices_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/rest-soap-webservices-lecture-p05.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/rest-soap-webservices-lecture-p05.webp" alt="Diagram from REST_SOAP_webservices_Lecture.pdf, page 5" width="1241" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 5</strong> &middot; REST_SOAP_webservices_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/rest-soap-webservices-lecture-p12.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/rest-soap-webservices-lecture-p12.webp" alt="Diagram from REST_SOAP_webservices_Lecture.pdf, page 12" width="1241" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 12</strong> &middot; REST_SOAP_webservices_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<p>Why they became popular: <strong>easy data sharing over the Internet</strong>, <strong>platform-independent communication</strong>, integration of different systems and platforms, and distributed application development. In other words, web services are <strong>Service Oriented Architecture (SOA)</strong> in practice: distributed application development whose typical example is the web service.</p>
<!-- dcc-fig:ch2/rest-soap-webservices-lecture-p06.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/rest-soap-webservices-lecture-p06.webp" alt="Diagram from REST_SOAP_webservices_Lecture.pdf, page 6" width="1241" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 6</strong> &middot; REST_SOAP_webservices_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/rest-soap-webservices-lecture-p10.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/rest-soap-webservices-lecture-p10.webp" alt="Diagram from REST_SOAP_webservices_Lecture.pdf, page 10" width="1241" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 10</strong> &middot; REST_SOAP_webservices_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/rest-soap-webservices-lecture-p11.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/rest-soap-webservices-lecture-p11.webp" alt="Diagram from REST_SOAP_webservices_Lecture.pdf, page 11" width="1241" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 11</strong> &middot; REST_SOAP_webservices_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>2.4.3 The two generations and their stacks</h3>
<p>Web Services 1.0 uses <strong>SOAP</strong> and the deck calls it "complex". Web Services 2.0 uses <strong>REST</strong> &mdash; less complex, <strong>lightweight and flexible</strong>, and <strong>the preferred model today</strong>. Each generation is a four-layer stack, and the layers are the cleanest way to compare them:</p>
<!-- dcc-fig:ch2/rest-soap-webservices-lecture-p07.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/rest-soap-webservices-lecture-p07.webp" alt="Diagram from REST_SOAP_webservices_Lecture.pdf, page 7" width="1241" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 7</strong> &middot; REST_SOAP_webservices_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<p>Layers are the right way to compare them because <strong>only the top three change</strong>. Both stacks sit on <strong>HTTP</strong>. SOAP then adds three layers of its own: <strong>WSDL</strong> describes the API in machine-readable form, <strong>SOAP</strong> wraps every message in an XML envelope, and the payload is <strong>XML</strong>. REST collapses the description and the envelope together: the payload is usually <strong>JSON</strong> (XML is allowed), and the meta-information rides in the HTTP headers instead of a wrapper, so there is often no machine-readable description at all &mdash; the optional WADL layer exists for completeness and, in the deck's words, is completely optional and rarely used. That one difference explains the adjectives: fewer layers to parse, fewer bytes on the wire and no tooling needed to read the interface make REST lightweight and flexible, while the same missing contract is what makes it weaker where a service must be described to a machine before it can be called.</p>
<figure class="figure-wide figure-wrap">
<svg class="figure wide" viewBox="0 0 700 300" role="img" aria-label="Two four-layer stacks side by side: the SOAP stack is WSDL for API description, SOAP for messaging, XML for data and HTTP for transport; the REST stack is WADL for API description, REST for messaging, JSON or XML for data and HTTP for transport, with WADL marked optional">
<defs><marker id="f2c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="flow-arrow-head"/></marker></defs>

<text class="flow-label" x="180" y="26" text-anchor="middle">Web Services 1.0 &mdash; SOAP</text>
<text class="flow-label" x="510" y="26" text-anchor="middle">Web Services 2.0 &mdash; REST</text>

<rect class="flow-box phase1" x="60" y="44" width="240" height="46" rx="9"/>
<text class="flow-text" x="180" y="72">WSDL &mdash; API description</text>
<rect class="flow-box phase2" x="60" y="100" width="240" height="46" rx="9"/>
<text class="flow-text" x="180" y="128">SOAP &mdash; messaging</text>
<rect class="flow-box phase3" x="60" y="156" width="240" height="46" rx="9"/>
<text class="flow-text" x="180" y="184">XML &mdash; data</text>
<rect class="flow-box phase4" x="60" y="212" width="240" height="46" rx="9"/>
<text class="flow-text" x="180" y="240">HTTP &mdash; transport</text>

<rect class="flow-box phase1" x="390" y="44" width="240" height="46" rx="9" opacity="0.45"/>
<text class="flow-text" x="510" y="66">WADL &mdash; API description</text>
<text class="flow-label" x="510" y="84" text-anchor="middle">completely optional, rarely used</text>
<rect class="flow-box phase2" x="390" y="100" width="240" height="46" rx="9"/>
<text class="flow-text" x="510" y="128">REST &mdash; messaging</text>
<rect class="flow-box phase3" x="390" y="156" width="240" height="46" rx="9"/>
<text class="flow-text" x="510" y="184">JSON / XML &mdash; data</text>
<rect class="flow-box phase4" x="390" y="212" width="240" height="46" rx="9"/>
<text class="flow-text" x="510" y="240">HTTP &mdash; transport</text>

<path class="flow-arrow" d="M180,90 V96" marker-end="url(#f2c)"/>
<path class="flow-arrow" d="M180,146 V152" marker-end="url(#f2c)"/>
<path class="flow-arrow" d="M180,202 V208" marker-end="url(#f2c)"/>
<path class="flow-arrow" d="M510,146 V152" marker-end="url(#f2c)"/>
<path class="flow-arrow" d="M510,202 V208" marker-end="url(#f2c)"/>
</svg>
<figcaption><strong>Fig 2.3 &mdash; Both web-service stacks are four layers thick, and only the top three change.</strong> HTTP is the transport in both. SOAP puts an envelope around the message over XML; REST uses the HTTP headers to carry meta information and can be used with JSON or XML, usually JSON because it parses easily. The optional WADL layer is the reason a REST service is easier to consume by hand: there is often no machine-readable description at all.</figcaption>
</figure>
<!-- dcc-fig:ch2/rest-soap-webservices-lecture-p14.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/rest-soap-webservices-lecture-p14.webp" alt="Diagram from REST_SOAP_webservices_Lecture.pdf, page 14" width="1241" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 14</strong> &middot; REST_SOAP_webservices_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>2.4.4 SOAP versus REST &mdash; the comparison to reproduce</h3>

<table class="comparison-table">
<thead>
<tr><th></th><th>SOAP web services</th><th>RESTful web services</th></tr>
</thead>
<tbody>
<tr><td><strong>Full name</strong></td><td>Simple Object Access Protocol</td><td>Representational State Transfer</td></tr>
<tr><td><strong>Messaging</strong></td><td>SOAP <strong>envelopes the message</strong>: it runs on HTTP but wraps its own message inside the HTTP message.</td><td><strong>Uses the HTTP headers to hold meta information</strong> &mdash; the operation and the resource are expressed by the method and the URL.</td></tr>
<tr><td><strong>Data format</strong></td><td><strong>XML based.</strong></td><td>Can be used <strong>with XML, JSON or whatever is necessary</strong>; usually <strong>JSON because it is easily parsable</strong>.</td></tr>
<tr><td><strong>API description</strong></td><td><strong>WSDL</strong> &mdash; a formal description of the service.</td><td><strong>WADL</strong>, which is <strong>completely optional and rarely used</strong>.</td></tr>
<tr><td><strong>HTTP methods</strong></td><td>Used mainly as a transport; the operation is named inside the SOAP body.</td><td>Uses the <strong>standard HTTP methods &mdash; GET, PUT, POST, DELETE</strong> &mdash; as the operations themselves.</td></tr>
<tr><td><strong>Speed</strong></td><td><strong>Slower than REST</strong>, because of the envelope and XML processing.</td><td><strong>Faster than SOAP.</strong></td></tr>
<tr><td><strong>Maturity and fit</strong></td><td><strong>Very mature, a lot of functionality</strong>, but <strong>not suitable for browser-based clients</strong> and more complicated to use.</td><td><strong>Lightweight and flexible</strong>, and the preferred model today.</td></tr>
<tr><td><strong>Example tooling</strong></td><td>Visual Studio: ASP.NET ASMX Web Service. Consumed by importing a WSDL URL &mdash; the deck's examples import public services such as <code>tempconvert.asmx?WSDL</code> and pick the methods <code>CelsiusToFahrenheit</code> and <code>FahrenheitToCelsius</code> from the description.</td><td>Visual Studio: ASP.NET Web API.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch2/rest-soap-webservices-lecture-p09.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/rest-soap-webservices-lecture-p09.webp" alt="Diagram from REST_SOAP_webservices_Lecture.pdf, page 9" width="1241" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 9</strong> &middot; REST_SOAP_webservices_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/rest-soap-webservices-lecture-p13.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/rest-soap-webservices-lecture-p13.webp" alt="Diagram from REST_SOAP_webservices_Lecture.pdf, page 13" width="1241" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 13</strong> &middot; REST_SOAP_webservices_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch2/rest-soap-webservices-lecture-p15.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/rest-soap-webservices-lecture-p15.webp" alt="Diagram from REST_SOAP_webservices_Lecture.pdf, page 15" width="1241" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 15</strong> &middot; REST_SOAP_webservices_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<div class="concept-box tip">
<h4>The shape of a good answer to "SOAP vs REST"</h4>
<p>Give the four-layer stack for each (Fig 2.3), then the three differences that actually change how you write code: <strong>the envelope versus the HTTP headers</strong>, <strong>XML only versus JSON or XML</strong>, and <strong>WSDL as a required description versus WADL as an optional one</strong>. Finish with the two consequences &mdash; REST is faster and works in a browser; SOAP is more mature and carries more functionality. A table does all of this in the space of a paragraph and is easier to mark.</p>
</div>
<h3>2.4.5 A 3-tier architecture with a web service</h3>
<p>The deck's worked example puts the pieces together as <strong>web server &rarr; web services &rarr; business logic &rarr; data source</strong>, split into a <strong>presentation</strong> layer, a <strong>logic</strong> layer and a <strong>foundations</strong> layer, installed on one or more servers in your LAN or in the cloud. This is the multitier model from Unit 1 (Fig 1.1) with the application tier exposed to the world as an API, and it is the bridge from this unit to Unit 5: once the application tier is a web service, where it runs stops mattering, and that is the beginning of cloud computing.</p>
<!-- dcc-fig:ch2/rest-soap-webservices-lecture-p08.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch2/rest-soap-webservices-lecture-p08.webp" alt="Diagram from REST_SOAP_webservices_Lecture.pdf, page 8" width="1241" height="1755" loading="lazy" decoding="async">
<figcaption><strong>page 8</strong> &middot; REST_SOAP_webservices_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<p>Read the layers in the order the deck presents them, because they are Unit 1's tiers with the middle one exposed to the network. The <strong>presentation</strong> layer is the client &mdash; a browser, or another program calling the API. The <strong>logic</strong> layer holds the web service and the business logic behind it. The <strong>foundations</strong> layer holds the data source and the server software the example installs, with the stored procedures living in the database rather than in the application. The sentence worth noticing is the smallest one in the slide: <em>installed on one or more servers in your LAN or in the Cloud</em>. Once the application tier can be reached as a web service over an ordinary HTTP connection, whether the machine behind that connection is yours or a provider's is an implementation detail &mdash; and a design that cannot tell the difference is exactly the one that can be moved into a cloud in Unit 5.</p>
<div class="concept-box tip">
<h4>The paper-facing part of this unit</h4>
<p>Everything in this unit that is written to be answered in the exam &mdash; what each question asks for, and the model answer to it &mdash; is collected in <a href="#/ch/2/past">Past Questions</a>. Read this tab for the subject; switch to that one when you sit down to answer a question.</p>
</div>
`,

  pastSummary: `<h2>Exam-facing summary</h2>
<table class="comparison-table">
<thead>
<tr><th>If the question says&hellip;</th><th>Give&hellip;</th></tr>
</thead>
<tbody>
<tr><td>Describe RPC with its working mechanism</td><td>The definition, then Fig 2.1's ten steps with <em>marshalling</em> named at step 2 and <em>unmarshalling</em> at step 5, then the request&ndash;reply protocol and the service interface.</td></tr>
<tr><td>What can go wrong in RPC / discuss RPC issues</td><td>The five faults (locate failure, lost request, lost reply, server crash, client crash) and then call semantics as the answer to them.</td></tr>
<tr><td>Explain call/invocation semantics</td><td>Exactly once, at-most-once (maybe), at-least-once, last once, last-of-many &mdash; with the fault each one tolerates and the cost it accepts. Name idempotency.</td></tr>
<tr><td>Explain the implementation/architecture of RMI</td><td>Proxy, dispatcher, skeleton, remote reference module, binder &mdash; plus the remote interface and the remote object reference, and Fig 2.2.</td></tr>
<tr><td>Compare RPC and RMI</td><td>Procedure versus object method; no object reference in the request versus a remote object reference; both use stubs; RMI adds a proxy, a skeleton and a binder; the same semantics family applies to both.</td></tr>
<tr><td>Explain message passing / MPI</td><td>Processes and their own data units, no shared data, send/recv with tag and wildcards, SPMD and collectives, the MPI six, and the costs (copying, buffering, tag matching).</td></tr>
<tr><td>Differentiate persistent and transient, or synchronous and asynchronous communication</td><td>The table in 2.3.7, with e-mail as persistent and client/server request&ndash;reply as synchronous, and the three drawbacks of the synchronous model.</td></tr>
<tr><td>Explain sockets</td><td>Endpoint objects, the client's socket naming host and destination port, the server's socket on a local port, connect and accept, then two-way messages; <code>Socket</code>/<code>ServerSocket</code> and the blocking read with <code>setSoTimeout</code>.</td></tr>
<tr><td>Compare SOAP and REST web services</td><td>Fig 2.3 plus the table in 2.4.4 &mdash; envelope versus headers, XML versus JSON, WSDL versus optional WADL, and the speed and browser-support consequences.</td></tr>
</tbody>
</table>


`,

  quiz: [
    {
      q: 'In step 2 of a remote procedure call, packing the arguments into a network message is called:',
      options: [
        'Unmarshalling',
        'Marshalling',
        'Serialization of the caller',
        'Binding'
      ],
      answer: 1,
      explanation: 'Marshalling is the outbound packing of parameters (and the name or number of the procedure) into a message; unmarshalling is the inbound unpacking, done by the server stub at step 5 and by the client stub on the result at step 10. Serialization is the general problem; marshalling is serialization for the purpose of a call.'
    },
    {
      q: 'A client sends an RPC request, the server executes the procedure, and the reply is lost. Why is simply retransmitting the request a poor default fix?',
      options: [
        'Because the client cannot retransmit without knowing the procedure name',
        'Because the client OS discards duplicate replies',
        'Because the procedure may then execute twice, while the client only needed the result it already produced',
        'Because the server will have crashed on the first request'
      ],
      answer: 2,
      explanation: 'This is the at-least-once hazard: retransmitting masks the omission failure but can cause the operation to run more than once, storing or returning wrong values (arbitrary failure). The reliable request-reply measures answer it directly — duplicate filtering at the server, and keeping a history of result messages so the lost reply can be re-sent without re-executing.'
    },
    {
      q: 'Which pair of systems uses at-most-once invocation semantics?',
      options: [
        'SUNRPC and MPI',
        'Java RMI and CORBA',
        'CORBA and SUNRPC',
        'Java RMI and SUNRPC'
      ],
      answer: 1,
      explanation: 'Java RMI and CORBA use at-most-once. CORBA also uses maybe semantics for methods that return no result, and SUNRPC provides at-least-once. Remember it as a set — this is a favourite short question.'
    },
    {
      q: 'In RMI, which component marshals arguments on the client side and unmarshals the results?',
      options: [
        'The skeleton',
        'The dispatcher',
        'The proxy',
        'The remote reference module'
      ],
      answer: 2,
      explanation: 'The proxy provides remote invocation transparency: it marshals arguments, forwards the request, receives the message and unmarshals results. The skeleton does the reverse on the server — unmarshals arguments, invokes the method, marshals the results — and the dispatcher only selects and passes on the correct method.'
    },
    {
      q: 'What is the responsibility of the remote reference module in RMI?',
      options: [
        'Translating between local and remote object references, and keeping the remote object table',
        'Sending and receiving messages over the network',
        'Selecting the correct method for an arriving request',
        'Registering textual names so clients can look objects up'
      ],
      answer: 0,
      explanation: 'It translates between local and remote object references and maintains the remote object table, with an entry for each remote object the process holds and each local proxy; it creates a remote object reference when one arrives, and looks up or creates one when a reference must be passed. Registering names is the binder, and selecting the method is the dispatcher.'
    },
    {
      q: 'A Java RMI client cannot create a remote object by calling its constructor directly. What does it use instead?',
      options: [
        'A static initialiser on the remote interface',
        'Factory methods',
        'The skeleton constructor',
        'The dispatcher'
      ],
      answer: 1,
      explanation: 'The deck states it as a rule about the client program: it cannot create remote objects by directly calling constructors, so factory methods are provided. This also explains why the server has an initialisation section that creates the remote objects and registers them with the binder.'
    },
    {
      q: 'Which statement about message passing is correct?',
      options: [
        'Processes share one data area and coordinate through locks',
        'Each process has its own data unit and there is no shared data; coordination is by send/recv',
        'Data is shared through the network interface card',
        'Messages are always delivered in the order sent, with no buffering'
      ],
      answer: 1,
      explanation: 'The work unit is processes, the data is decomposed so each process owns its own unit, there is no shared data, and coordination is by exchanging messages through send and receive calls — the mail analogy. Buffering, tag matching and packetization are exactly the costs the deck lists.'
    },
    {
      q: 'In MPI, which pair of calls brackets every other call?',
      options: [
        'MPI_Send and MPI_Recv',
        'MPI_Comm_size and MPI_Comm_rank',
        'MPI_Init and MPI_Finalize',
        'MPI_Init and MPI_Barrier'
      ],
      answer: 2,
      explanation: 'MPI_Init initialises the library and MPI_Finalize terminates its use; all MPI calls must occur between them, temporally. Comm_size and Comm_rank are how the program learns the number of processes and its own identifier.'
    },
    {
      q: 'A message-passing implementation sends the header first and does not send the data until the destination replies that it is ready. Which protocol is this?',
      options: [
        'Eager',
        'Short',
        'Rendezvous',
        'Broadcast'
      ],
      answer: 2,
      explanation: 'Rendezvous waits for an ok-to-send reply before the message is sent, so no large receive buffer is needed and the receiver cannot be overrun — at the cost of a round trip. Short is when the message fits internal buffers; eager sends immediately without waiting for the receiver.'
    },
    {
      q: 'Under persistent communication, a message is:',
      options: [
        'Discarded as soon as it cannot be delivered at the next server or receiver',
        'Stored at a communication server for as long as it takes to deliver it to the receiver',
        'Delivered only if the sender and receiver are active at the same time',
        'Stored on the sender until the sender is ready to resend'
      ],
      answer: 1,
      explanation: 'Persistent communication stores the message at the communication server until delivery is possible, however long that takes — the Pony Express analogy, and the basis of e-mail. Transient communication is the opposite: the message is discarded as soon as it cannot be delivered at the next server or the receiver.'
    },
    {
      q: 'Which is a stated drawback of synchronous communication in client/server computing?',
      options: [
        'The server cannot process more than one request in total',
        'The client cannot do any other work while waiting for a reply',
        'Messages cannot be stored in buffers',
        'The client does not know the server address'
      ],
      answer: 1,
      explanation: 'Three drawbacks are given: the client cannot do other work while waiting, failures must be dealt with immediately because the client is blocked, and in many cases the model is simply not appropriate — mail and news being the examples. Persistent, asynchronous, queued messaging is the alternative.'
    },
    {
      q: 'In the SOAP web service stack, which layer describes the API?',
      options: [
        'XML',
        'SOAP',
        'WSDL',
        'HTTP'
      ],
      answer: 2,
      explanation: 'The stack is WSDL (API description) over SOAP (messaging) over XML (data) over HTTP (transport). The REST stack is the same shape with WADL — completely optional and rarely used — over REST over JSON/XML over HTTP.'
    },
    {
      q: 'Why do web services use HTTP as their transport?',
      options: [
        'Because HTTP is the fastest available transport protocol',
        'Because it is a standard web protocol that browsers, servers and most languages support, so it passes through firewalls',
        'Because it encrypts the payload by default',
        'Because it provides the WSDL description'
      ],
      answer: 1,
      explanation: 'The problem being solved is that a direct connection to the database is not possible over the Internet because of firewalls and security. HTTP is supported by every browser and server and by libraries in every modern programming language, so it is the transport a firewall will allow through — not the fastest possible transport.'
    },
    {
      q: 'Which is a difference between REST and SOAP web services?',
      options: [
        'REST uses WSDL as a required description, SOAP uses WADL',
        'SOAP uses the HTTP headers to carry meta information, REST envelopes the message',
        'REST uses standard HTTP methods such as GET, PUT, POST and DELETE, and is usually used with JSON',
        'SOAP can only be consumed by browser-based clients'
      ],
      answer: 2,
      explanation: 'REST uses the standard HTTP methods as the operations and is usually used with JSON because it parses easily; it is faster than SOAP and works in a browser. SOAP envelopes the message over XML with a required WSDL description, is very mature but more complicated, and is not suitable for browser-based clients.'
    },
    {
      q: 'In the deck\'s RPC advantages list, why is "based on call-by-value and call-by-reference parameters only" a disadvantage?',
      options: [
        'Because call-by-value is slower than call-by-name',
        'Because a value can be copied into a message but a reference is meaningful only in one address space',
        'Because the stub cannot marshal more than one parameter',
        'Because call-by-reference does not exist in Java'
      ],
      answer: 1,
      explanation: 'This is the serialization boundary. A value can be marshalled into a message and reconstructed at the other end; a reference is a pointer into one address space and means nothing in another, which is why passing objects remotely needs remote object references and the machinery of 2.2.'
    }
  ],

  past: [
    {
      year: 'Model 2025',
      marks: '4',
      repeats: 2,
      q: 'Describe Remote Procedure Call (RPC) with its working mechanism.',
      occ: [
        { year: 'Model 2025', marks: '4', q: 'Describe Remote Procedure Call (RPC) with its working mechanism.' },
        { year: 'Final 2025', marks: '2', q: 'Define RPC (Remote Procedure Call) and RMI (Remote Method Invocation).' }
      ],
      answer: `
<h4>Model answer &mdash; 4 marks</h4>
<p><strong>Definition.</strong> A Remote Procedure Call is an interaction between a client and a server in which <strong>the client invokes a procedure that resides remotely on a server</strong>. The server executes the procedure and passes the result back to the client; while the call is in progress, the calling of the procedure is <strong>blocked</strong> and is resumed only after the result arrives. RPC is based on the <strong>single-process procedure call model</strong> and so is a high-level network communication interface. A server process exposes a <strong>service interface</strong> defining the procedures available for remote calling, and works under a <strong>request&ndash;reply protocol</strong> that omits the object reference from request messages.</p>

<p><strong>Working mechanism.</strong> The call passes through a stub on each side, which is what makes a remote call look like a local one:</p>
<ol>
<li>The client procedure calls the <strong>client stub</strong> in the normal way.</li>
<li>The client stub builds a message containing the parameters and the name or number of the procedure, and calls the local operating system. This packaging is called <strong>marshalling</strong>.</li>
<li>The client sends the message to the remote OS via a system call to the local kernel, using a connectionless or connection-oriented protocol.</li>
<li>The remote OS gives the message to the <strong>server stub</strong>.</li>
<li>The server stub <strong>unmarshals</strong> the parameters and calls the server.</li>
<li>The server does the work and returns the result to the stub.</li>
<li>The server stub packs the result in a message and calls its local OS.</li>
<li>The server's OS sends the message to the client's OS.</li>
<li>The client's OS gives the message to the client stub.</li>
<li>The client stub unpacks the result and returns it to the waiting client procedure.</li>
</ol>

<p><strong>Faults and semantics (add this if there is room).</strong> Five faults are possible: the client cannot locate the server, the request message is lost, the reply message is lost, the server crashes after receiving a request, or the client crashes after sending one. <strong>Call semantics</strong> define when and how often the procedure may be executed &mdash; exactly once (hard in practice, needing time-outs, retransmissions, the same call identifier and a callee cache), at most once or maybe, at least once, last once, and last-of-many. A reliable request&ndash;reply protocol uses three measures: retrying the request, filtering duplicates at the server, and <strong>keeping a history of results</strong> so a lost reply can be re-sent without re-executing the operation.</p>

<div class="concept-box tip">
<h4>Where this came from</h4>
<p>Group B, question 7 of the <em>Model Question 2025</em>, worth 4 marks (Group A is <code>2*4 = 8</code>, Group C is three questions of 8 marks, and <code>8 + 7(4) + 3(8) = 60</code>). The question asks for the <em>working mechanism</em>, so the ten steps are the answer and everything else is context. Draw Fig 2.1 if you have time &mdash; a labelled diagram of client/stub/kernel and server/stub/kernel usually marks faster than prose.</p>
</div>`
    }
  ]
};

;
/* ch3.js */
/* Chapter 3 — Synchronization and Coordination.

   Syllabus unit 3: 5 hours, 6 marks. Sub-topics 3.1 Clock Synchronization
   (Cristian's Algorithm, NTP), 3.2 Logical Clocks (Lamport's and Vector
   Clocks), 3.3 Mutual Exclusion Algorithms (Ricart-Agrawala, Token Ring),
   3.4 Election Algorithms (Bully, Ring).

   Written from Er. Avijit Karn's 94-slide Chapter 3 deck, read into
   `_source/dcc/lecture_notes_all_chapterwise_ch_3_sync_and_cordn.txt` by
   tools/dcc_extract.py. The deck is mostly pictures — 74 of its 94 slides
   carry text inside their images — so the extracted file contains both the
   text frames and the OCR of every slide picture. The Cristian's-algorithm
   arithmetic, the NTP offset derivation and the election walkthroughs below
   are read out of those recovered picture labels, not reconstructed.

   This unit is worth more in the exam than its 6 marks suggest: three
   questions of the Model Question 2025 come from it — Group A question 3,
   Group B question 8 and Group C question 14. */

window.CHAPTERS = window.CHAPTERS || {};
window.CHAPTERS[3] = {
  learn: `

<h2>Unit 3 &mdash; Synchronization and Coordination</h2>
<p class="unit-meta">Syllabus: 5 hours &middot; 6 marks &middot; sub-topics 3.1&ndash;3.4</p>

<div class="concept-box asked">
<h4>What this unit is worth in the exam</h4>
<ul>
<li><strong>2 marks</strong> &mdash; &ldquo;List any two clock synchronization algorithms used in distributed systems.&rdquo; (<em>Group A, question 3</em> of the Model Question 2025 &mdash; the easiest two marks on that paper.)</li>
<li><strong>4 marks</strong> &mdash; &ldquo;Explain Lamport's logical clock with a suitable example.&rdquo; (Group B, question 8)</li>
<li><strong>8 marks</strong> &mdash; &ldquo;Describe in detail the working and applications of the Bully election algorithm.&rdquo; (<em>Group C, question 14</em> &mdash; a full long question.)</li>
</ul>
<p>That is <strong>14 marks of paper on a unit the syllabus weights at 6</strong>. No other unit in this course is as well represented relative to its size, and all three questions are answerable from 3.1&ndash;3.4 directly. If only one unit gets full attention, this is a strong candidate.</p>
</div>

<p>The unit has a shape worth knowing before you start, because the four sub-topics are stages of one argument rather than four separate topics. <strong>3.1 Clock synchronization</strong> asks whether two machines can agree on the time, and answers with Cristian's algorithm and NTP. It cannot succeed completely, which is the point: clocks drift, and no amount of synchronisation removes the drift. <strong>3.2 Logical clocks</strong> is the response to that failure &mdash; stop measuring time and start ordering events, with Lamport's counter and vector clocks. <strong>3.3 Mutual exclusion</strong> applies that ordering to the classic problem of one resource and many claimants, and compares the permission-based and token-based algorithm families. <strong>3.4 Election algorithms</strong> asks who decides when the process that was deciding has failed. So the study order is the same as the reading order: agreement on time, then ordering without time, then using the ordering, then choosing a leader.</p>

<p>Two study notes for this unit specifically. Every algorithm here is assessed against the <strong>four requirements</strong> in 3.3.2 &mdash; safety, liveness, fairness and (for mutual exclusion) the number of messages &mdash; so learn that checklist first and run each algorithm through it; it converts a list of algorithms into a comparison, which is what the paper rewards. And this unit rewards <em>worked examples</em> more than any other: the Lamport timestamp question, the Bully election question and the Ricart&ndash;Agrawala example all ask you to apply a rule to specific messages or processes, so practise the arithmetic rather than memorising the description.</p>

<h2>3.0 Time in distributed systems &mdash; the problem this unit solves</h2>

<p>The deck opens by calling time <strong>the most important practical issue in distributed systems, and also the most problematic</strong>. The example it gives is concrete: we require computers around the world to <strong>timestamp electronic commerce transactions consistently</strong>. More fundamentally, we need to understand how distributed executions unfold, and that requires being able to say what happened when.</p>

<p>Three facts make this hard, and they are the whole motivation for the unit:</p>
<ul>
<li><strong>Each computer has its own physical clock</strong>, so there is no single clock to read.</li>
<li><strong>The clocks typically deviate</strong>, and <strong>we cannot synchronize them perfectly</strong>.</li>
<li><strong>The absence of global physical time makes it difficult to find the state of our distributed programs as they execute.</strong> We often need to know what state process A is in when process B is in a certain state, but we cannot rely on physical clocks to tell us what is true <em>at the same time</em>.</li>
</ul>

<h3>3.0.1 How a computer timer actually works</h3>
<p>A computer timer is a <strong>counter register and a holding register</strong>. The counter is decremented by a <strong>quartz crystal oscillator</strong>; when it reaches zero, <strong>an interrupt is generated and the counter is reloaded from the holding register</strong> &mdash; for example 60 times per second. <strong>Each interrupt is called a clock tick.</strong></p>

<p>A <strong>physical clock</strong> is therefore an electronic device that counts oscillations in a crystal at a definite frequency, typically divides the count, and stores the result in a counter register. Two further definitions follow from it:</p>
<ul>
<li><strong>Drift rate</strong> is the rate at which the clock ticks. Different clocks have different drift rates, and hence need to be synchronized; the drift rate is also how you determine <em>how often</em> they should be synchronized.</li>
<li>A <strong>synchronized</strong> clock is one whose value must not deviate from real time by more than a certain amount &mdash; and when that additional constraint is added, <strong>physical clocks must be the same</strong>, which is the harder requirement.</li>
</ul>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s05-040.webp -->
<figure class="figure-wrap teacher-i" title="The teacher's deck marks this slide with a circled i &mdash; the sign he puts on pages he is not going to examine. The section is kept because the syllabus still names what it teaches.">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s05-040.webp" alt="Not all clocks tick precisely at the current rate." width="1600" height="1392" loading="lazy" decoding="async">
<figcaption><strong>slide 5</strong> &middot; Ch_3_Sync_and_Cordn.pptx &mdash; Not all clocks tick precisely at the current rate. <span class="tmark-chip"><span class="tmark" aria-hidden="true"></span><span class="tmark-text">teacher marks this slide</span></span></figcaption>
</figure>
<!-- /dcc-fig -->
<div class="concept-box key">
<h4>Why time is on this syllabus at all</h4>
<p>The deck lists six reasons, and they are a ready-made answer to "why do distributed systems need time?": <strong>precise performance measurements</strong>, <strong>guaranteeing up-to-date or recent data</strong>, <strong>temporal ordering of events produced by concurrent processes</strong>, <strong>synchronization between senders and receivers of messages</strong>, <strong>coordination of joint activities</strong>, and <strong>serialization of concurrent accesses to shared objects</strong>. Note how the last three point straight at 3.3 and 3.4 of this unit.</p>
</div>

<h3>3.0.2 What unsynchronized clocks break &mdash; the <code>make</code> example</h3>
<p>The classic failure, and the one to quote when a question asks for a consequence of clock skew: in Unix, the <strong><code>make</code></strong> command is used to compile new or modified code without recompiling unchanged code. <strong><code>make</code> uses the clock of the machine it runs on to determine which source files need to be recompiled.</strong> If the sources reside on a separate file server and the two machines have unsynchronized clocks, <strong>the <code>make</code> program might not produce the correct results</strong> &mdash; it may decide an output is newer than the source that produced it and skip a rebuild that was needed.</p>

<p>The general statement of the failure: <strong>when each machine has its own clock, an event that occurred after another event may nevertheless be assigned an earlier time</strong>. That is not a performance problem; it is a correctness problem, and the deck's compiler/editor timeline on slides 8 shows exactly one such inversion: the object file created on one machine carries a timestamp that places it <em>before</em> the source edit that caused it.</p>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s08-041.webp -->
<figure class="figure-wrap teacher-i" title="The teacher's deck marks this slide with a circled i &mdash; the sign he puts on pages he is not going to examine. The section is kept because the syllabus still names what it teaches.">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s08-041.webp" alt="Fig: When each machine has its own clock, an event that occurred after another event may nevertheless be assigned an earlier time" width="579" height="168" loading="lazy" decoding="async">
<figcaption><strong>slide 8</strong> &middot; Ch_3_Sync_and_Cordn.pptx &mdash; Fig: When each machine has its own clock, an event that occurred after another event may nevertheless be assigned an earlier time <span class="tmark-chip"><span class="tmark" aria-hidden="true"></span><span class="tmark-text">teacher marks this slide</span></span></figcaption>
</figure>
<!-- /dcc-fig -->
<h3>3.0.3 Event ordering and the happened-before relation</h3>
<p>Since there is no common memory and no common clock, it is <strong>sometimes impossible to say which of two events occurred first</strong>. The answer is not to measure time better but to define order without it. The <strong>happened-before relation</strong> (<code>&rarr;</code>) is a <strong>partial ordering of events</strong> defined by three rules:</p>
<ol>
<li>If <strong>A and B are events in the same process, and A was executed before B</strong>, then A &rarr; B.</li>
<li>If <strong>A is the event of sending a message by one process and B is the event of receiving that message by another process</strong>, then A &rarr; B.</li>
<li>If <strong>A &rarr; B and B &rarr; C, then A &rarr; C</strong> (transitivity).</li>
</ol>
<p>If two events A and B are not related by &rarr;, they are <strong>executed concurrently</strong> &mdash; that is, there is no causal relationship between them. To obtain a global ordering of all events, each event is timestamped so that <strong>for every pair of events A and B, if A &rarr; B then the timestamp of A is less than the timestamp of B</strong>.</p>

<div class="concept-box warn">
<h4>Read that last sentence twice</h4>
<p>The requirement is one-directional: <em>if A happened before B, then ts(A) &lt; ts(B)</em>. <strong>The converse need not be true.</strong> A timestamp order does not prove a causal order, and every limitation in 3.2 follows from that gap. This is the single most examinable sentence in the unit.</p>
</div>

<h3>3.0.4 Causal ordering of messages</h3>
<p>The first place event ordering has a practical cost: <strong>if M1 is sent before M2, then every recipient of both messages must get M1 before M2</strong> &mdash; and the <strong>underlying network will not necessarily give this guarantee</strong>. Consider a replicated database system: updates to the entries should be received <em>in order</em>, or replicas diverge. The <strong>basic idea is to buffer a later message</strong> until the earlier one it causally depends on has been delivered. Vector clocks, in 3.2.4, are the mechanism that makes "later" decidable.</p>

<p>The order messages are <em>sent</em> in is not the order they are <em>received</em> in, and nothing in the network promises otherwise: two messages can take different routes, and a later one can overtake an earlier one. Causal ordering adds the guarantee that matters &mdash; not one global order everyone agrees on, but that an effect is never seen before its cause. All the work sits in the buffering rule: a process that receives a message whose causal predecessor it has not yet seen has to hold it, which means it needs a way to decide whether one message depends on another. That decision is exactly what Lamport timestamps cannot make (they order everything, and prove nothing about concurrency) and vector clocks can, which is why this section and 3.2 belong together.</p>

<h2>3.1 Clock Synchronization: Cristian's Algorithm and NTP</h2>

<p>The deck splits clock synchronization into two families, and this split is itself a good answer to "name the approaches":</p>

<table class="comparison-table">
<thead>
<tr><th>Family</th><th>Algorithms</th><th>What is synchronized</th></tr>
</thead>
<tbody>
<tr><td><strong>Physical clock synchronization</strong></td><td>Cristian's algorithm &mdash; centralized system. Network Time Protocol (NTP) &mdash; distributed system.</td><td>The clocks themselves are moved toward real time (UTC).</td></tr>
<tr><td><strong>Logical clock synchronization</strong></td><td>Lamport timestamps &mdash; distributed system. Vector clocks &mdash; distributed system.</td><td>Nothing physical: a counter is maintained so that causal order is captured numerically.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s12-042.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s12-042.webp" alt="Physical Clock Synchronization" width="1600" height="1188" loading="lazy" decoding="async">
<figcaption><strong>slide 12</strong> &middot; Ch_3_Sync_and_Cordn.pptx &mdash; Physical Clock Synchronization</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s18-043.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s18-043.webp" alt="Physical Clock Synchronization" width="1600" height="1188" loading="lazy" decoding="async">
<figcaption><strong>slide 18</strong> &middot; Ch_3_Sync_and_Cordn.pptx &mdash; Physical Clock Synchronization</figcaption>
</figure>
<!-- /dcc-fig -->
<div class="concept-box tip">
<h4>Group A, question 3 answered in one line</h4>
<p>&ldquo;List any two clock synchronization algorithms&rdquo;: <strong>Cristian's algorithm and the Network Time Protocol</strong> for physical clocks, or <strong>Lamport timestamps and vector clocks</strong> for logical clocks. Either pair is correct; giving the physical pair and adding "and for logical ordering, Lamport timestamps and vector clocks" shows you know the distinction the syllabus is drawing.</p>
</div>
<h3>3.1.1 Cristian's algorithm</h3>
<p>Cristian's algorithm <strong>relies on the existence of a time server</strong>. The time server maintains its clock using a <strong>radio clock or other accurate time source</strong>, and <strong>all other computers in the system stay synchronized with it</strong>. A time client maintains its clock by <strong>making a procedure call to the time server</strong>.</p>

<p>The procedure, as the deck states it, is three steps. Let P be a process and S a time server connected to a source of <strong>UTC</strong> (Coordinated Universal Time):</p>
<ol>
<li><strong>P requests the time from S.</strong></li>
<li><strong>After receiving the request, S prepares a response and appends the time T from its own clock.</strong></li>
<li><strong>P then sets its time to T + RTT/2</strong>, where RTT is the round-trip time of the request it made.</li>
</ol>

<figure class="figure-wide figure-wrap">
<svg class="figure wide" viewBox="0 0 760 300" role="img" aria-label="Cristian's algorithm timeline: the client sends a request at its time T0, the server timestamps its reply with T, the client receives the reply at T1, and sets its clock to T plus half the round trip time">
<defs><marker id="f3a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="flow-arrow-head"/></marker></defs>

<text class="flow-label" x="90" y="26" text-anchor="middle">Client P</text>
<text class="flow-label" x="640" y="26" text-anchor="middle">Time server S (UTC)</text>
<path class="flow-arrow" d="M90,40 V258"/>
<path class="flow-arrow" d="M640,40 V258"/>

<circle class="flow-dot" cx="90" cy="72" r="4"/>
<text class="flow-label" x="46" y="77">T0</text>
<path class="flow-arrow" d="M96,72 H634" marker-end="url(#f3a)"/>
<text class="flow-label" x="360" y="64" text-anchor="middle">request</text>

<circle class="flow-dot" cx="640" cy="120" r="4"/>
<text class="flow-label" x="656" y="125">T (server clock)</text>
<circle class="flow-dot" cx="640" cy="176" r="4"/>
<text class="flow-label" x="656" y="181">S prepares reply</text>
<path class="flow-arrow" d="M634,176 H96" marker-end="url(#f3a)"/>
<text class="flow-label" x="360" y="168" text-anchor="middle">reply with T appended</text>

<circle class="flow-dot" cx="90" cy="228" r="4"/>
<text class="flow-label" x="46" y="233">T1</text>
<text class="flow-label" x="360" y="250" text-anchor="middle">RTT = T1 &minus; T0 &nbsp;&middot;&nbsp; one-way delay estimated as RTT/2 &nbsp;&middot;&nbsp; P sets its clock to T + RTT/2</text>
<text class="flow-label" x="360" y="272" text-anchor="middle">assumes the round trip is split equally between request and response</text>
</svg>
<figcaption><strong>Fig 3.1 &mdash; Cristian's algorithm.</strong> Both T0 and T1 are measured with the <em>same</em> clock, which is the whole trick: the client never needs the server's clock to be readable, only a timestamp and its own elapsed time. The deck's slide 14 identifies <code>(T1 &minus; T0)</code> as the Round Trip Time and shows the interrupt-handling time as a third quantity to be subtracted.</figcaption>
</figure>

<p><strong>Worked example from the deck (slide 17).</strong> The client sends its request at <strong>5:08:15.100</strong> (T0) and receives the response at <strong>5:08:15.900</strong> (T1). The response contains <strong>5:09:25.300</strong> (Tserver).</p>
<ul>
<li>Round-trip time = T1 &minus; T0 = 5:08:15.900 &minus; 5:08:15.100 = <strong>800 ms</strong>.</li>
<li>Best guess: the timestamp was generated <strong>400 ms ago</strong>, so the local time is set to Tserver + round-trip-time/2 = 5:09:25.300 + 400 = <strong>5:09:25.700</strong>.</li>
<li><strong>Accuracy: &plusmn; round-trip-time/2.</strong></li>
</ul>

<h3>3.1.2 How accurate is Cristian's algorithm, exactly?</h3>
<p>This is the part of the deck that examiners like, because it shows whether you understand <em>why</em> the estimate is an estimate. The method <strong>assumes the RTT is split equally between request and response</strong>, "which may not always be the case but is a reasonable assumption on a LAN connection". Accuracy can be improved by <strong>making multiple requests to S and using the response with the shortest RTT</strong>.</p>

<p>Let <strong>min</strong> be the minimum time to transmit a message one-way. Then the earliest point at which S could have placed the time T was <strong>min after P sent its request</strong>. Therefore the time at S, when the message is received by P, lies <strong>in the range (T + min) to (T + RTT &minus; min)</strong>. The width of that range is <strong>(RTT &minus; 2&middot;min)</strong>, which gives an accuracy of <strong>(RTT/2 &minus; min)</strong>.</p>

<div class="concept-box warn">
<h4>Two practical constraints the deck adds</h4>
<p>First, <strong>the time server needs to change its time gradually</strong> &mdash; a large jump forward or backward would confuse every timer and measurement running on the client, so a correction is applied by slewing the clock rather than setting it. Second, while responding to a client the server <strong>must consider message delays</strong>, which is exactly what the RTT correction above is doing. A third constraint from the slides is easy to miss: the client's <strong>interrupt handling time</strong> is part of the measurement, which is why the corrected forms of the formula subtract it.</p>
</div>

<h3>3.1.3 Network Time Protocol (NTP)</h3>
<p>NTP is <strong>the most commonly used Internet time protocol and the one that provides the best accuracy</strong> (RFC 1305). The operational facts are the ones to quote:</p>
<ul>
<li><strong>Computers often include NTP software in the OS.</strong> The client software <strong>periodically gets updates from one or more servers and averages them</strong>.</li>
<li><strong>Time servers listen to NTP requests on port 123</strong>, and reply with a <strong>UDP/IP data packet in NTP format</strong>, which is a <strong>64-bit timestamp in UTC seconds since 1 Jan 1900, with a resolution of 200 picoseconds</strong>.</li>
<li>Many PC clients get time from a <strong>single server with no averaging</strong>; this simple version is called <strong>SNTP</strong> (Simple Network Time Protocol, RFC 2030).</li>
</ul>

<p>Servers are arranged in a <strong>synchronization subnet</strong> of strata: the <strong>1st stratum</strong> is machines connected directly to an accurate time source, the <strong>2nd stratum</strong> machines are synchronized from 1st-stratum machines, and so on down. A client's distance from the source is therefore <em>how many strata away</em> it is, and the deck's diagram shows stratum 1 at the top with stratum 2 and stratum 3 layered beneath it.</p>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s20-044.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s20-044.webp" alt="NTP synchronization subnet" width="593" height="244" loading="lazy" decoding="async">
<figcaption><strong>slide 20</strong> &middot; Ch_3_Sync_and_Cordn.pptx &mdash; NTP synchronization subnet</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>3.1.4 NTP goals and synchronization modes</h3>
<table class="comparison-table">
<thead>
<tr><th>NTP goals</th><th>How each is met</th></tr>
</thead>
<tbody>
<tr><td>Enable clients across the Internet to be accurately synchronized to UTC despite message delays</td><td>The offset calculation in 3.1.5, which removes the asymmetry of the round trip.</td></tr>
<tr><td>Use statistical techniques to filter data and improve quality of results</td><td>Averaging updates from several servers; the SNTP client that skips this is explicitly the less accurate one.</td></tr>
<tr><td>Provide reliable service, and survive lengthy losses of connectivity</td><td><strong>Redundant paths and redundant servers.</strong></td></tr>
<tr><td>Enable clients to synchronize frequently</td><td>Periodic polling, with adjustment of clocks by using the <strong>offset</strong> (in symmetric mode).</td></tr>
<tr><td>Provide protection against interference</td><td><strong>Authenticate the source of data.</strong></td></tr>
</tbody>
</table>

<table class="comparison-table">
<thead>
<tr><th>NTP mode</th><th>Accuracy</th><th>How it works</th></tr>
</thead>
<tbody>
<tr><td><strong>Multicast</strong></td><td>Low accuracy, for quick LANs</td><td>The server periodically multicasts its time to its clients in the subnet.</td></tr>
<tr><td><strong>Remote Procedure Call</strong></td><td>Medium accuracy</td><td>The server responds to client requests with its actual timestamp &mdash; like Cristian's algorithm.</td></tr>
<tr><td><strong>Symmetric mode</strong></td><td>High accuracy</td><td>Used to synchronize <strong>between the time servers</strong>, peer to peer.</td></tr>
</tbody>
</table>
<p>In all three, <strong>messages are delivered unreliably with UDP</strong> &mdash; which is why the protocol needs many rounds and statistical filtering rather than one careful exchange.</p>

<h3>3.1.5 The NTP offset derivation</h3>
<p>Four timestamps are involved, and the derivation is the most mathematical thing in the unit. Client A and server B:</p>
<ul>
<li><strong>T1</strong> &mdash; A sends its request at this time (A's clock).</li>
<li><strong>T2</strong> &mdash; B receives the request at this time (B's clock).</li>
<li><strong>T3</strong> &mdash; B responds at this time, sending the values of T2 and T3 (B's clock).</li>
<li><strong>T4</strong> &mdash; A receives the response (A's clock).</li>
</ul>
<p>The question is <strong>&theta; = TB &minus; TA</strong>: by how much do the two clocks differ? Two assumptions make it answerable: <strong>the transit time is approximately the same in both directions</strong>, and B is the server A wants to synchronize to.</p>
<ol>
<li>A knows <strong>(T4 &minus; T1)</strong> from its own clock.</li>
<li>B reports <strong>T3 and T2</strong> in its response.</li>
<li>A therefore computes the <strong>total transit time of both messages</strong> as <strong>(T4 &minus; T1) &minus; (T3 &minus; T2)</strong> &mdash; the elapsed time minus the time B spent working on it.</li>
<li>One-way transit time is approximately half of that, so <strong>B's clock at T4 reads approximately [(T4 &minus; T1) + (T2 + T3)] / 2</strong>.</li>
<li>The <strong>difference between the B and A clocks at T4</strong> is therefore<br><strong>&theta; = [(T2 &minus; T1) + (T3 &minus; T4)] / 2</strong>.</li>
</ol>

<div class="concept-box key">
<h4>The one step to explain rather than state</h4>
<p>Step 3 is the step that earns marks: <strong>(T4 &minus; T1)</strong> is the whole journey as measured by one clock, and <strong>(T3 &minus; T2)</strong> is the part of it that was the server thinking, not travelling. Subtracting the second from the first leaves the time actually spent on the wire. Without that subtraction you are measuring the server's processing time as if it were network delay &mdash; which is exactly the error Cristian's algorithm accepts and NTP removes.</p>
</div>

<h2>3.2 Logical Clocks: Lamport and Vector Clocks</h2>

<p>The deck is careful to state the goal of physical synchronization before moving away from it, and the statement is worth keeping: <strong>the goal of clock synchronization is to minimize the difference between the accepted actual time and the time on a given client machine</strong>. When that is achieved, the clocks in the set are "more closely in sync". But even with more accurate clocks corrected more often, <strong>developers of distributed systems should still be wary of relying on local clock time</strong>, because:</p>
<ul>
<li>Because there are corrections going on, <strong>the time recorded for an event might actually have happened at a different time on another computer</strong>, because of differing drift rates of those computer timers.</li>
<li><strong>Correcting time does not mean all machines agree on time &mdash; it means they are much closer to each other on average.</strong> For some distributed systems that may be sufficient; for others it may not.</li>
</ul>

<h3>3.2.1 Logical clocks &mdash; the idea</h3>
<p>Invented by <strong>Lamport (1978)</strong>, a logical clock is <strong>a simple mechanism by which the happened-before ordering can be captured numerically</strong>. Precisely:</p>
<ul>
<li>It is a <strong>monotonically increasing software counter</strong>, whose value <strong>need bear no particular relationship to any physical clock</strong>.</li>
<li>Each process <code>pi</code> keeps its own logical clock <code>Li</code>, which it uses to apply so-called <strong>Lamport timestamps</strong> to events.</li>
<li>It provides <strong>consistent event ordering</strong>.</li>
</ul>
<p>The deck's own illustration of the difference: <strong>it is adequate that all machines agree that it is 10:00 even if it is really 10:02</strong>. What matters is the <strong>internal consistency</strong> of the clocks, not whether they are close to real time.</p>

<p>Architecturally, logical clocks live in the <strong>middleware layer</strong>: the application sends a message, and the middleware <strong>adjusts the local clock and timestamps the message</strong> before the network layer carries it; on receipt the middleware delivers it to the application after the clock has been updated. The application never manipulates a logical clock directly &mdash; which is why the mechanism can be added to an existing system without changing its programs.</p>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s32-045.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s32-045.webp" alt="Lamport’s Logical Clocks" width="1335" height="564" loading="lazy" decoding="async">
<figcaption><strong>slide 32</strong> &middot; Ch_3_Sync_and_Cordn.pptx &mdash; Lamport’s Logical Clocks</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>3.2.2 Lamport's algorithm</h3>
<p>A Lamport logical clock is <strong>an incrementing software counter maintained in each process</strong>. The algorithm has three rules:</p>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s34-046.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s34-046.webp" alt="Example: Lamport’s Algorithm" width="1600" height="554" loading="lazy" decoding="async">
<figcaption><strong>slide 34</strong> &middot; Ch_3_Sync_and_Cordn.pptx &mdash; Example: Lamport’s Algorithm</figcaption>
</figure>
<!-- /dcc-fig -->
<ol>
<li><strong>A process increments its counter before each event in that process.</strong></li>
<li><strong>When a process sends a message, it includes its counter value with the message.</strong></li>
<li><strong>On receiving a message, the receiver sets its counter to be greater than the maximum of its own value and the received value, before it considers the message received.</strong></li>
</ol>
<p>Conceptually, the logical clock <strong>can be thought of as a clock that only has meaning in relation to messages moving between processes: when a process receives a message, it resynchronizes its logical clock with that sender</strong>.</p>

<p>Read the three rules as one rule about messages: a counter is only ever pushed forward by <em>sending</em> or by <em>receiving</em>, so the value a process holds is a summary of everything it has heard about. Rule 3 is the one that repays attention, and the reason it takes a <strong>maximum</strong> instead of a simple increment is that the receiver may already have done work of its own that the sender knows nothing about; taking the larger value is what keeps the causal direction consistent. The result is a <strong>total order</strong> over the events of the whole system &mdash; every event gets a number and no two events tie &mdash; which is enough for the classic use: putting concurrent requests for the same resource into one agreed order, which is exactly what the mutual-exclusion algorithms of 3.3 are built on. What it is <em>not</em> enough for is the reverse direction, and the deck warns about this in its slides on the limitation. <strong>A smaller timestamp does not imply that the event happened first.</strong> Two concurrent events can be numbered 3 and 7 with no causal relation between them, so Lamport timestamps can put an order on two updates that never saw each other &mdash; a false positive. Vector clocks (3.2.4) exist to remove it, and this is the subject of the Model Question 2025 card in the Past Questions tab, so an answer should carry both halves: the algorithm, and its limit.</p>

<figure class="figure-wide figure-wrap">
<svg class="figure wide" viewBox="0 0 780 330" role="img" aria-label="Lamport timestamps on three processes: each process increments its counter at each event, and a message carries the sender's counter so the receiver jumps to one more than the maximum of its own value and the received value">
<defs><marker id="f3b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="flow-arrow-head"/></marker></defs>

<text class="flow-label" x="70" y="24" text-anchor="middle">p1</text>
<text class="flow-label" x="390" y="24" text-anchor="middle">p2</text>
<text class="flow-label" x="700" y="24" text-anchor="middle">p3</text>
<path class="flow-arrow" d="M70,34 V300"/>
<path class="flow-arrow" d="M390,34 V300"/>
<path class="flow-arrow" d="M700,34 V300"/>

<circle class="flow-dot" cx="70" cy="60" r="4"/><text class="flow-label" x="34" y="65">1</text>
<circle class="flow-dot" cx="70" cy="130" r="4"/><text class="flow-label" x="34" y="135">2</text>
<circle class="flow-dot" cx="70" cy="250" r="4"/><text class="flow-label" x="34" y="255">4</text>

<circle class="flow-dot" cx="390" cy="90" r="4"/><text class="flow-label" x="354" y="95">1</text>
<circle class="flow-dot" cx="390" cy="180" r="4"/><text class="flow-label" x="354" y="185">2</text>
<circle class="flow-dot" cx="390" cy="265" r="4"/><text class="flow-label" x="354" y="270">5</text>

<circle class="flow-dot" cx="700" cy="140" r="4"/><text class="flow-label" x="664" y="145">1</text>
<circle class="flow-dot" cx="700" cy="220" r="4"/><text class="flow-label" x="664" y="225">2</text>

<path class="flow-arrow" d="M74,132 L386,182" marker-end="url(#f3b)"/>
<text class="flow-label" x="228" y="146" text-anchor="middle">m carries 2</text>
<path class="flow-arrow" d="M394,182 L696,142" marker-end="url(#f3b)"/>
<text class="flow-label" x="548" y="152" text-anchor="middle">m carries 2</text>
<path class="flow-arrow" d="M696,222 L394,267" marker-end="url(#f3b)"/>
<text class="flow-label" x="548" y="250" text-anchor="middle">m carries 2</text>
<path class="flow-arrow" d="M386,267 L74,252" marker-end="url(#f3b)"/>
<text class="flow-label" x="228" y="282" text-anchor="middle">m carries 5</text>

<text class="flow-label" x="390" y="318" text-anchor="middle">on receipt the counter becomes one more than max(own, received) &mdash; which is why p2 jumps 2 &rarr; 3 on the message from p1</text>
</svg>
<figcaption><strong>Fig 3.2 &mdash; Lamport timestamps and the happened-before relation.</strong> Every counter value along a process increases, and a message always carries a value lower than the receive event that follows it &mdash; so rule 2 of happened-before is respected numerically. The dashed fact to remember is that this is <em>one-directional</em>: two concurrent events can carry 3 and 7 with no causal link between them, which is exactly what the deck's slide 40 warns about and what vector clocks fix.</figcaption>
</figure>

<h3>3.2.3 Lamport's considerations, and the limitation</h3>
<p>Two implementation details must hold for the timestamps to be usable:</p>
<ul>
<li>For any two events <em>a</em> and <em>b</em> in the same process, with <code>C(x)</code> the timestamp of event <em>x</em>, it is necessary that <strong><code>C(a)</code> never equals <code>C(b)</code></strong>. So the logical clock must be set so that there is <strong>at least one clock tick (one increment) between events</strong>.</li>
<li>In a multiprocessor or multithreaded environment it may be necessary to <strong>attach the process ID or another unique ID to the timestamp</strong>, so that events that occur simultaneously in different processes can be told apart.</li>
</ul>

<p>Two further statements from the deck complete the picture. A distributed system is said to have <strong>partial order</strong> if a partial-order relationship exists among the events; if <strong>totality</strong> &mdash; a causal relationship among <em>all</em> events &mdash; can be established, the system has <strong>total order</strong>. And on update ordering in replicated systems: the problem is <strong>how to ensure all sites recognize a fixed order on updates even when updates are delivered out of order</strong>; the solution is to <strong>assign timestamps to updates at their accepting site and order them by source timestamp at the receiver, giving nodes unique IDs and breaking ties with the origin node ID</strong>. Comparing <em>physical</em> timestamps for this is arbitrary, because physical clocks drift &mdash; and even loosely synchronized physical clocks cannot order events that occurred at almost exactly the same time.</p>

<table class="comparison-table">
<thead>
<tr><th>What Lamport's clocks <em>do</em></th><th>What they do not do</th></tr>
</thead>
<tbody>
<tr><td><strong>a &rarr; b implies ts(a) &lt; ts(b).</strong> Every event in the system can be totally ordered by timestamp, consistently with causality.</td><td><strong>ts(a) &lt; ts(b) does <em>not</em> imply a &rarr; b.</strong> Nothing can be said about the actual real time of A and B; a logical order is not a real-time order. The problem is that the clocks <strong>do not capture causality violations</strong>.</td></tr>
<tr><td>Gives a total order, which is enough for many purposes (for example, deciding which of two updates is "later").</td><td><strong>If we know that A &rarr; C and B &rarr; C, we cannot say which of A or B initiated C.</strong> The deck explains why that matters: when recovering after a crash, knowing the causal relationships between messages lets you replay them in an order that respects causality, and get the node back to the state it needs to be in.</td></tr>
</tbody>
</table>

<h3>3.2.4 Vector clocks</h3>
<p>Vector clocks exist precisely because of that gap. The formal statement from the deck: <strong>a vector clock is an algorithm for generating a partial ordering of events in a distributed system and detecting causality violations</strong>. As with Lamport timestamps, <strong>inter-process messages contain the state of the sending process's logical clock</strong> &mdash; but the state is now a vector.</p>

<ul>
<li><strong>A vector clock of a system of N processes is an array (vector) of N logical clocks, one clock per process.</strong> A local "smallest possible values" copy of the global clock array is kept in each process.</li>
<li>The purpose is a <strong>more detailed representation of what a site might know</strong>.</li>
</ul>

<p>The rules, as the deck states them:</p>
<ol>
<li>In a system with N nodes, <strong>each site keeps a vector timestamp <code>TS[N]</code> as well as a logical clock LC</strong>. <code>TS[i]</code> at site <em>i</em> is the most recent value of site <em>j</em>'s logical clock that site <em>i</em> has <strong>heard about</strong>, and each site keeps its own LC in <code>TS[i]</code>.</li>
<li>When site <em>i</em> generates a new event, <strong>it increments its logical clock</strong>.</li>
<li>When site <em>r</em> observes an event (for example, receives a message) from site <em>s</em>, it <strong>sets its TS<sub>r</sub> to the pairwise maximum of TS<sub>r</sub> and TS<sub>s</sub></strong>: for each site <em>i</em>, <code>TSr[i] = max(TSr[i], TSs[i])</code>.</li>
</ol>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s43-047.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s43-047.webp" alt="Diagram from Ch_3_Sync_and_Cordn.pptx, slide 43" width="547" height="334" loading="lazy" decoding="async">
<figcaption><strong>slide 43</strong> &middot; Ch_3_Sync_and_Cordn.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>The simple version of the algorithm is easier to remember and is what an exam answer should give:</p>
<ul>
<li><strong>Initially all clocks are zero.</strong></li>
<li>Each time a process experiences an <strong>internal event</strong>, it <strong>increments its own logical clock in the vector by one</strong>.</li>
<li>Each time a process <strong>prepares to send a message</strong>, it increments its own clock in the vector by one and then <strong>sends its entire vector along with the message</strong>.</li>
<li>Each time a process <strong>receives a message</strong>, it increments its own clock by one and <strong>updates each element in its vector by taking the maximum of the value in its own vector and the value in the received vector, for every element</strong>.</li>
</ul>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s45-048.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s45-048.webp" alt="Vector Clock: Example" width="735" height="407" loading="lazy" decoding="async">
<figcaption><strong>slide 45</strong> &middot; Ch_3_Sync_and_Cordn.pptx &mdash; Vector Clock: Example</figcaption>
</figure>
<!-- /dcc-fig -->
<div class="concept-box key">
<h4>Why vector clocks are "necessary and sufficient"</h4>
<p>The deck's argument, in its own order: logical clocks induce an order consistent with causality, but <strong>the converse of the clock condition does not hold</strong> &mdash; it may be that <code>LC(e1) &lt; LC(e2)</code> even when e1 and e2 are concurrent. "If A could know anything before B knows, then it must be that LC<sub>A</sub> &gt; LC<sub>B</sub>; but if LC<sub>A</sub> &gt; LC<sub>B</sub> then this doesn't make it so" &mdash; these are <strong>false positives</strong>, and the consequence is that <strong>concurrent updates may be ordered unnecessarily</strong>. A vector clock is the mechanism that is <strong>necessary and sufficient for capturing causality</strong>: two events are causally related exactly when one vector dominates the other element-by-element, and events whose vectors do <em>not</em> dominate each other are provably concurrent &mdash; which is how a replicated store detects a genuine conflict (two updates to the same item, neither timestamp dominating the other) instead of inventing an arbitrary winner.</p>
</div>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s46-049.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s46-049.webp" alt="Diagram from Ch_3_Sync_and_Cordn.pptx, slide 46" width="551" height="371" loading="lazy" decoding="async">
<figcaption><strong>slide 46</strong> &middot; Ch_3_Sync_and_Cordn.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>3.2.5 Causal ordering of messages using vector clocks</h3>
<p>Vector clocks pay for themselves here. <strong>Causal ordering of messages</strong> means <strong>maintaining the same causal order of message receive events as of message send events</strong>: if <code>Send(M1) &rarr; Send(M2)</code> and <code>Receive(M1)</code> and <code>Receive(M2)</code> are on the same process, then <code>Receive(M1) &rarr; Receive(M2)</code>. It is useful, for example, for replicated databases.</p>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s48-050.webp -->
<figure class="figure-wrap teacher-i" title="The teacher's deck marks this slide with a circled i &mdash; the sign he puts on pages he is not going to examine. The section is kept because the syllabus still names what it teaches.">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s48-050.webp" alt="Causal Ordering of Message using Vector  Clock" width="648" height="291" loading="lazy" decoding="async">
<figcaption><strong>slide 48</strong> &middot; Ch_3_Sync_and_Cordn.pptx &mdash; Causal Ordering of Message using Vector  Clock <span class="tmark-chip"><span class="tmark" aria-hidden="true"></span><span class="tmark-text">teacher marks this slide</span></span></figcaption>
</figure>
<!-- /dcc-fig -->
<p>Two algorithms are named:</p>
<ul>
<li><strong>Birman&ndash;Schiper&ndash;Stephenson (BSS)</strong> causal ordering of <em>broadcasts</em>.</li>
<li><strong>Schiper&ndash;Eggli&ndash;Sandoz (SES)</strong> causal ordering of <em>regular messages</em>.</li>
</ul>
<p>The basic idea of both is the same, and it is the same sentence from 3.0.4: <strong>use the vector clock to delay out-of-order message delivery</strong> until the messages it depends on have been delivered.</p>

<p>Why vector clocks are unavoidable here: to delay a message you must be able to tell whether it is <em>later</em> than one you are still waiting for, and Lamport timestamps cannot answer that question &mdash; they will order two events that may be concurrent (the false positive of 3.2.2). A vector timestamp can. Message M1 causally precedes M2 exactly when M1's vector is dominated by M2's, so the receiver of M2 knows precisely which earlier messages must have arrived first, and holds M2 until they have. The two named algorithms differ only in what they are applied to, and that is the distinction worth writing down: <strong>BSS</strong> orders <em>broadcasts</em>, where every process is a recipient of every message and one extra vector per message is therefore enough; <strong>SES</strong> orders <em>ordinary point-to-point messages</em>, where a process cannot know what a peer has already seen and each message must carry more state to compensate. The application the deck names makes it concrete: a replicated database, where applying two updates in different orders on different replicas leaves the copies permanently different.</p>

<h2>3.3 Mutual Exclusion Algorithms</h2>

<h3>3.3.1 Background</h3>
<p>The deck first separates three communication scenarios, because mutual exclusion is not always needed:</p>
<ul>
<li><strong>One-way communication</strong> usually does <em>not</em> need mutual exclusion.</li>
<li><strong>Client/server communication</strong> is multiple clients making service requests to a shared server. If coordination is required among the clients it is <strong>handled by the server</strong>, and there is no explicit interaction among client processes &mdash; and hence <strong>no need for mutual exclusion</strong>.</li>
<li><strong>Inter-process communication</strong>, where processes must exchange information to reach a conclusion about the system or an agreement among cooperating processes, is where it is needed.</li>
</ul>

<p>The vocabulary is the shared-memory vocabulary extended to a distributed setting:</p>
<table class="comparison-table">
<thead>
<tr><th>Term</th><th>Definition</th></tr>
</thead>
<tbody>
<tr><td><strong>Critical section (region)</strong></td><td>A section of code or region in which a process or thread <strong>competes in a potentially destructive way</strong> with another process or thread for access to a shared data item or file.</td></tr>
<tr><td><strong>Race condition</strong></td><td>A problem caused by accessing the critical section from two or more processes at the same time.</td></tr>
<tr><td><strong>Mutual exclusion</strong></td><td>The solution to the race condition. If two processes are allowed to be concurrently in competing critical sections, <strong>incorrect results may be computed</strong>; ensuring this destructive interaction does not occur is mutual exclusion.</td></tr>
</tbody>
</table>
<p>In other words, <strong>mutual exclusion is the process of allowing only one process to enter the critical section at the same time</strong>.</p>

<h3>3.3.2 The four requirements</h3>
<p>These are stated as requirements and are a good opening paragraph for any mutual-exclusion answer &mdash; they are the shared-memory requirements, but they apply unchanged:</p>
<ol>
<li><strong>Safety</strong> &mdash; at most one process in the critical section.</li>
<li><strong>Liveness</strong> &mdash; if more than one process is requesting, someone enters.</li>
<li><strong>No starvation</strong> &mdash; a requesting process enters within a finite time.</li>
<li><strong>Fairness</strong> &mdash; requests are granted in order.</li>
</ol>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s52-051.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s52-051.webp" alt="Diagram from Ch_3_Sync_and_Cordn.pptx, slide 52" width="1028" height="614" loading="lazy" decoding="async">
<figcaption><strong>slide 52</strong> &middot; Ch_3_Sync_and_Cordn.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>Note how the four divide. <strong>Safety</strong> says what must never happen, and it is enforced by the protocol's own rules; the other three are claims about progress, and progress is what a bad protocol breaks first &mdash; a scheme in which one process holds the right forever is perfectly safe and completely useless. Fairness is the strongest of the three, because granting requests in order implies no starvation, which implies liveness. So when you assess the algorithms in this unit &mdash; the central coordinator (3.3.4), Lamport's and Ricart&ndash;Agrawala's permission schemes, and the token ring (3.3.5) &mdash; run each against these four requirements in order and name what it costs to satisfy them. The cost is almost always a message count, and that is what makes the comparison examinable.</p>
<h3>3.3.3 The two approaches and the algorithm families</h3>
<table class="comparison-table">
<thead>
<tr><th>Approach</th><th>How the right is granted</th><th>Algorithms</th></tr>
</thead>
<tbody>
<tr><td><strong>Non-token-based</strong> (permission-based)</td><td>Each process <strong>freely and equally competes</strong> for the right to use the shared resource; requests are arbitrated either by a central control site or by distributed agreement.</td><td>Permission from a <strong>central coordinator</strong>: central coordinator based algorithm. Permission from <strong>all distributed processes</strong>: Lamport's algorithm, Ricart&ndash;Agrawala algorithm.</td></tr>
<tr><td><strong>Token-based</strong></td><td>A <strong>logical token</strong> representing the access right is passed in a regulated fashion among the processes; <strong>whoever holds the token is allowed to enter the critical section</strong>.</td><td>Token Ring algorithm, Suzuki&ndash;Kasami, Raymond, Singhal and others.</td></tr>
</tbody>
</table>

<p>The two families answer one question &mdash; who may enter? &mdash; with opposite default answers, and the rest follows. Permission-based algorithms say <em>ask first</em>: nothing happens until enough peers agree, so a request costs messages and a failure usually costs a wait, but no process can enter by accident, and correctness is easy to argue. Token-based algorithms say <em>hold and use</em>: the right to enter is an object, and whoever holds it is already entitled to enter, so entering costs nothing at all and the design problem moves wholesale to the token &mdash; how to find it when it is lost or its holder dies (which is an election, 3.4), and how to keep it circulating so that nobody waits for a full lap of the ring. That is the trade to state in an answer: <strong>message cost per entry</strong> against <strong>a single object whose loss stops everything</strong>.</p>

<h3>3.3.4 Ricart&ndash;Agrawala &mdash; the syllabus's named non-token algorithm</h3>
<p>Ricart&ndash;Agrawala is <strong>an improvement over Lamport's</strong> algorithm, and the deck states the kernel of the improvement precisely: <strong>node j need not send a REPLY to node i if j has a request with a timestamp lower than the request of i</strong>, since i cannot enter before j anyway in this case. The messages that would have been sent to convey a decision that the timestamp already determines are simply not sent.</p>

<p>Its properties, as listed:</p>
<ul>
<li><strong>Does not require FIFO</strong> channels &mdash; ordering is carried in the timestamps, not the transport.</li>
<li><strong>2(n &minus; 1) messages per critical-section invocation</strong> &mdash; a request to every other node, and a reply from every other node.</li>
<li><strong>Synchronization delay = maximum message transmission time.</strong></li>
<li><strong>Requests are granted in order of increasing timestamps.</strong></li>
</ul>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s55-052.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s55-052.webp" alt="Diagram from Ch_3_Sync_and_Cordn.pptx, slide 55" width="1086" height="683" loading="lazy" decoding="async">
<figcaption><strong>slide 55</strong> &middot; Ch_3_Sync_and_Cordn.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>The algorithm itself, in the deck's wording:</p>
<ol>
<li><strong>To request the critical section:</strong> send a timestamped REQUEST message <code>(tsi, i)</code>.</li>
<li><strong>On receiving a request <code>(tsi, i)</code> at j:</strong> <strong>send REPLY to i if j is neither requesting nor executing</strong>; <strong>if j is requesting, and i's request timestamp is smaller than j's request timestamp</strong>, also send REPLY; <strong>otherwise, defer the request</strong>.</li>
<li><strong>i enters the critical section on receiving REPLY from all nodes</strong> &mdash; and then <strong>sends REPLY to all deferred requests</strong>, which is what releases the nodes that were waiting behind it.</li>
</ol>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s56-053.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s56-053.webp" alt="Diagram from Ch_3_Sync_and_Cordn.pptx, slide 56" width="1028" height="693" loading="lazy" decoding="async">
<figcaption><strong>slide 56</strong> &middot; Ch_3_Sync_and_Cordn.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s57-054.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s57-054.webp" alt="Ricart-Agrawala in the deck&#x27;s own example: P1 and P2 both request the resource, timestamps (11,1) and (15,2) decide the order, and the lower timestamp enters first." width="701" height="281" loading="lazy" decoding="async">
<figcaption><strong>slide 57</strong> &middot; Ch_3_Sync_and_Cordn.pptx &mdash; Ricart-Agrawala in the deck&#x27;s own example: P1 and P2 both request the resource, timestamps (11,1) and (15,2) decide the order, and the lower timestamp enters first.</figcaption>
</figure>
<!-- /dcc-fig -->
<div class="concept-box tip">
<h4>The idea to state in one sentence</h4>
<p>Ricart&ndash;Agrawala is <strong>a distributed vote in which the vote can be inferred rather than sent</strong>: since every node orders requests by timestamp, a node that is itself waiting with an earlier timestamp does not need to reply at all, because its own request already tells the requester to wait. That is where the message saving over a plain "ask everyone, wait for everyone" scheme comes from.</p>
</div>

<h3>3.3.5 Token-based algorithms and the Token Ring</h3>
<p>The token-based family shares one property: <strong>a single token circulates, and a process enters the critical section when it holds the token</strong>, so mutual exclusion is obvious by construction. The algorithms in the family differ in <strong>how a process finds and gets the token</strong>, and they use <strong>sequence numbers rather than timestamps</strong> to distinguish old from current requests.</p>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s59-055.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s59-055.webp" alt="Diagram from Ch_3_Sync_and_Cordn.pptx, slide 59" width="1027" height="487" loading="lazy" decoding="async">
<figcaption><strong>slide 59</strong> &middot; Ch_3_Sync_and_Cordn.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>The <strong>Token Ring algorithm</strong> is the simplest member and the one named in the syllabus:</p>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s62-057.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s62-057.webp" alt="Token Ring Algorithm" width="410" height="427" loading="lazy" decoding="async">
<figcaption><strong>slide 62</strong> &middot; Ch_3_Sync_and_Cordn.pptx &mdash; Token Ring Algorithm</figcaption>
</figure>
<!-- /dcc-fig -->
<ul>
<li><strong>The n processes P1, P2, &hellip; Pn are arranged in a logical ring.</strong> The ring is created by <strong>giving each process the address of one other process, its neighbour in the clockwise direction</strong>. Crucially, <strong>the logical ring topology is unrelated to the physical interconnections</strong> between the computers.</li>
<li><strong>The token is initially given to one process</strong> and is passed from one process to its neighbour round the ring.</li>
<li>When a process <strong>requires to enter the critical section, it waits until it receives the token from its left neighbour and then retains it</strong>; after entering and leaving the critical section it <strong>passes the token to its neighbour in the clockwise direction</strong>.</li>
<li>When a process <strong>receives the token but does not require the critical section, it immediately passes the token on along the ring</strong>.</li>
</ul>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s61-056.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s61-056.webp" alt="Diagram from Ch_3_Sync_and_Cordn.pptx, slide 61" width="626" height="383" loading="lazy" decoding="async">
<figcaption><strong>slide 61</strong> &middot; Ch_3_Sync_and_Cordn.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s63-058.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s63-058.webp" alt="Token Ring Algorithm" width="621" height="392" loading="lazy" decoding="async">
<figcaption><strong>slide 63</strong> &middot; Ch_3_Sync_and_Cordn.pptx &mdash; Token Ring Algorithm</figcaption>
</figure>
<!-- /dcc-fig -->
<table class="comparison-table">
<thead>
<tr><th>Property</th><th>Consequence</th></tr>
</thead>
<tbody>
<tr><td>It can take <strong>from 1 to n&minus;1 messages to obtain a token</strong>.</td><td>Worst-case latency is a full lap of the ring.</td></tr>
<tr><td><strong>Messages are sent around the ring even when no process requires the token</strong>.</td><td>Additional load on the network in the idle case.</td></tr>
<tr><td>It <strong>works well in heavily loaded situations</strong>, when there is a high probability that the process receiving the token wants to enter the critical section.</td><td>High utilisation means few wasted laps.</td></tr>
<tr><td>It <strong>works poorly in lightly loaded cases</strong>.</td><td>Most laps carry a token nobody wanted.</td></tr>
<tr><td><strong>If a process fails, no progress can be made until a reconfiguration extracts the process from the ring.</strong></td><td>The failure-handling problem is not in the algorithm but in the recovery around it.</td></tr>
<tr><td><strong>If the process holding the token fails, a unique process has to be picked to regenerate the token</strong> and pass it along the ring &mdash; <strong>an election algorithm has to be run for this purpose.</strong></td><td>This is the direct link from 3.3 to 3.4, and worth stating in an answer: token loss is why elections exist.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s64-059.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s64-059.webp" alt="Token Ring Algorithm" width="622" height="560" loading="lazy" decoding="async">
<figcaption><strong>slide 64</strong> &middot; Ch_3_Sync_and_Cordn.pptx &mdash; Token Ring Algorithm</figcaption>
</figure>
<!-- /dcc-fig -->
<h2>3.4 Election Algorithms: Bully and Ring</h2>

<p>In distributed computing, <strong>leader election is the process of designating a single process as the organizer of some task distributed among several computers (nodes)</strong>. Before the task begins, <strong>all nodes are unaware which node will serve as the leader, or coordinator; after a leader election algorithm has run, each node throughout the network recognizes a particular, unique node as the task leader</strong>.</p>

<p>Many distributed algorithms require one process to act as a coordinator or perform some special role, and that coordinator is selected using an election algorithm. The deck's examples of <em>why</em>:</p>
<table class="comparison-table">
<thead>
<tr><th>Situation</th><th>Why an election is needed</th></tr>
</thead>
<tbody>
<tr><td><strong>Clock synchronization</strong> (Berkeley algorithm)</td><td>To <strong>select a leader or master to take responsibility for averaging the time</strong>.</td></tr>
<tr><td><strong>Mutual exclusion</strong> &mdash; central coordinator algorithm</td><td>At initialization, or <strong>whenever the coordinator crashes, a new coordinator has to be elected</strong>.</td></tr>
<tr><td><strong>Mutual exclusion</strong> &mdash; token ring algorithm</td><td><strong>When the process holding the token fails, a new process has to be elected which generates the new token.</strong></td></tr>
<tr><td><strong>Any distributed computing</strong></td><td>A distributed algorithm <strong>does not assume the previous existence of a central coordinator</strong>; a master must be selected to <strong>distribute sub-problems among the slaves and collect the partial results</strong> from them.</td></tr>
</tbody>
</table>

<h3>3.4.1 Basic concepts</h3>
<ul>
<li><strong>A unique priority number is associated with each active process</strong>, with the priority number of process P<sub>i</sub> being <em>i</em>, and there is a <strong>one-to-one correspondence between processes and sites</strong>.</li>
<li><strong>The coordinator is always the process with the largest priority number</strong>; when a coordinator fails, the algorithm must elect the <strong>active</strong> process with the largest priority number. Note the word <em>active</em> &mdash; a crashed node keeps its high number but cannot win.</li>
<li><strong>It does not matter which process is elected; what is important is that one and only one process is chosen and that all processes agree on this decision.</strong></li>
<li><strong>Election is typically started after a failure occurs.</strong> Detection of failure (for example, the crash of the current coordinator) is <strong>normally based on a time-out</strong>: a process that gets no response for a period of time suspects a failure and initiates an election.</li>
</ul>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s68-060.webp -->
<figure class="figure-wrap teacher-i" title="The teacher's deck marks this slide with a circled i &mdash; the sign he puts on pages he is not going to examine. The section is kept because the syllabus still names what it teaches.">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s68-060.webp" alt="Election Algorithm: Basic Concepts (1)" width="704" height="329" loading="lazy" decoding="async">
<figcaption><strong>slide 68</strong> &middot; Ch_3_Sync_and_Cordn.pptx &mdash; Election Algorithm: Basic Concepts (1) <span class="tmark-chip"><span class="tmark" aria-hidden="true"></span><span class="tmark-text">teacher marks this slide</span></span></figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s69-061.webp -->
<figure class="figure-wrap teacher-i" title="The teacher's deck marks this slide with a circled i &mdash; the sign he puts on pages he is not going to examine. The section is kept because the syllabus still names what it teaches.">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s69-061.webp" alt="Election Algorithm: Basic Concepts (2)" width="536" height="437" loading="lazy" decoding="async">
<figcaption><strong>slide 69</strong> &middot; Ch_3_Sync_and_Cordn.pptx &mdash; Election Algorithm: Basic Concepts (2) <span class="tmark-chip"><span class="tmark" aria-hidden="true"></span><span class="tmark-text">teacher marks this slide</span></span></figcaption>
</figure>
<!-- /dcc-fig -->
<p><strong>Every election algorithm has two phases</strong>, and stating them is a reliable way to structure an answer:</p>
<ol>
<li><strong>Select a leader with the highest priority.</strong></li>
<li><strong>Inform all processes about the winner.</strong></li>
</ol>

<h3>3.4.2 The Bully algorithm</h3>
<p>The Bully algorithm is <strong>applicable to elect a leader in a distributed system in which every process can send a message to every other process</strong> &mdash; the deck's example of such a system is a mesh topology &mdash; and it is <strong>a method for dynamically selecting a coordinator by process ID number</strong>.</p>

<p><strong>Assumptions:</strong> the system is <strong>synchronous</strong> and <strong>uses time-out for identifying process failure</strong>. Each process knows which process has the higher identifier number and communicates with it.</p>

<p><strong>Three message types</strong>, and an answer should name all three:</p>
<table class="comparison-table">
<thead>
<tr><th>Message</th><th>Meaning</th></tr>
</thead>
<tbody>
<tr><td><strong>Election message</strong></td><td>Sent to announce an election.</td></tr>
<tr><td><strong>Answer message</strong></td><td>Sent to respond to an election message &mdash; the "I am alive" reply.</td></tr>
<tr><td><strong>Coordinator message</strong></td><td>Sent to announce the identity of the elected process.</td></tr>
</tbody>
</table>

<p><strong>Basic steps.</strong> When a process P determines that the current coordinator is down &mdash; because of message time-outs, or the coordinator's failure to initiate a handshake &mdash; it performs the following sequence:</p>
<ol>
<li><strong>P broadcasts an election message (inquiry) to all other processes with higher process IDs.</strong></li>
<li><strong>If P hears from no process with a higher process ID than it, it wins the election and broadcasts victory.</strong></li>
<li><strong>If P hears from a process with a higher ID, P waits a certain amount of time for that process to broadcast itself as the leader. If it does not receive this message in time, it re-broadcasts the election message.</strong></li>
<li><strong>If P gets an election message from another process with a lower ID, it sends an "I am alive" message back and starts a new election.</strong></li>
</ol>

<div class="concept-box key">
<h4>Where the name comes from</h4>
<p>The deck explains it in one sentence, and that sentence is the model answer to "why is it called the Bully algorithm": <strong>if P receives a victory message from a process with a lower ID number, it immediately initiates a new election</strong> &mdash; <strong>a process with a higher ID number will bully a lower ID process out of the coordinator position as soon as it comes online.</strong> The recovered process does not accept the existing coordinator, however well it is working; a bigger number always wins.</p>
</div>

<p><strong>The detailed algorithm</strong>, as the deck presents it, is the same rules stated with the two time-out intervals made explicit:</p>
<ul>
<li>If process P<sub>i</sub> sends a request that is <strong>not answered by the coordinator within a time interval T</strong>, assume the coordinator has failed and P<sub>i</sub> tries to elect itself as the new coordinator.</li>
<li>P<sub>i</sub> <strong>sends an election message to every process with a higher priority number</strong>, then <strong>waits for any of these processes to answer within T</strong>.</li>
<li><strong>If no response within T</strong>, assume all processes with numbers greater than <em>i</em> have failed, and <strong>P<sub>i</sub> elects itself the new coordinator</strong>.</li>
<li><strong>If an answer is received</strong>, P<sub>i</sub> begins time interval <strong>T&prime;</strong>, waiting to receive a message that a process with a higher priority number has been elected.</li>
<li><strong>If no message is sent within T&prime;</strong>, assume the process with the higher number has failed, and P<sub>i</sub> should <strong>restart the algorithm</strong>.</li>
</ul>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s76-062.webp -->
<figure class="figure-wrap teacher-i" title="The teacher's deck marks this slide with a circled i &mdash; the sign he puts on pages he is not going to examine. The section is kept because the syllabus still names what it teaches.">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s76-062.webp" alt="Bully Algorithm: Detailed Algorithm" width="716" height="252" loading="lazy" decoding="async">
<figcaption><strong>slide 76</strong> &middot; Ch_3_Sync_and_Cordn.pptx &mdash; Bully Algorithm: Detailed Algorithm <span class="tmark-chip"><span class="tmark" aria-hidden="true"></span><span class="tmark-text">teacher marks this slide</span></span></figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s77-063.webp -->
<figure class="figure-wrap teacher-i" title="The teacher's deck marks this slide with a circled i &mdash; the sign he puts on pages he is not going to examine. The section is kept because the syllabus still names what it teaches.">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s77-063.webp" alt="Diagram from Ch_3_Sync_and_Cordn.pptx, slide 77" width="760" height="386" loading="lazy" decoding="async">
<figcaption><strong>slide 77</strong> &middot; Ch_3_Sync_and_Cordn.pptx <span class="tmark-chip"><span class="tmark" aria-hidden="true"></span><span class="tmark-text">teacher marks this slide</span></span></figcaption>
</figure>
<!-- /dcc-fig -->
<p>Two further rules describe what happens to a process that is <em>not</em> the coordinator, and they matter because they are what makes the algorithm converge. At any time during execution, P<sub>i</sub> may receive one of two messages from process P<sub>j</sub>:</p>
<ul>
<li><strong>P<sub>j</sub> is the new coordinator (j &gt; i)</strong> &mdash; P<sub>i</sub> records this information.</li>
<li><strong>P<sub>j</sub> started an election (j &gt; i)</strong> &mdash; P<sub>i</sub> sends a response to P<sub>j</sub> and begins its own election algorithm, provided it has not already initiated one.</li>
</ul>
<p>And the rule for a node coming back from failure: <strong>after a failed process recovers, it immediately begins execution of the same algorithm</strong>, and <strong>if there are no active processes with higher numbers, the recovered process forces all processes with lower numbers to let it become the coordinator &mdash; even if there is currently an active coordinator with a lower number</strong>.</p>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s78-064.webp -->
<figure class="figure-wrap teacher-i" title="The teacher's deck marks this slide with a circled i &mdash; the sign he puts on pages he is not going to examine. The section is kept because the syllabus still names what it teaches.">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s78-064.webp" alt="Diagram from Ch_3_Sync_and_Cordn.pptx, slide 78" width="777" height="538" loading="lazy" decoding="async">
<figcaption><strong>slide 78</strong> &middot; Ch_3_Sync_and_Cordn.pptx <span class="tmark-chip"><span class="tmark" aria-hidden="true"></span><span class="tmark-text">teacher marks this slide</span></span></figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s84-069.webp -->
<figure class="figure-wrap teacher-i" title="The teacher's deck marks this slide with a circled i &mdash; the sign he puts on pages he is not going to examine. The section is kept because the syllabus still names what it teaches.">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s84-069.webp" alt="Diagram from Ch_3_Sync_and_Cordn.pptx, slide 84" width="616" height="426" loading="lazy" decoding="async">
<figcaption><strong>slide 84</strong> &middot; Ch_3_Sync_and_Cordn.pptx <span class="tmark-chip"><span class="tmark" aria-hidden="true"></span><span class="tmark-text">teacher marks this slide</span></span></figcaption>
</figure>
<!-- /dcc-fig -->
<figure class="figure-wide figure-wrap">
<svg class="figure wide" viewBox="0 0 800 320" role="img" aria-label="Bully election with six processes P0 to P5: P2 starts an election to higher-numbered processes, P3 and P4 answer and start their own elections, P4 gets no answer from P5 and announces itself coordinator to everyone">
<defs><marker id="f3c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="flow-arrow-head"/></marker></defs>

<rect class="flow-box phase1" x="30" y="60" width="90" height="40" rx="8"/><text class="flow-text" x="75" y="85">P0</text>
<rect class="flow-box phase1" x="150" y="60" width="90" height="40" rx="8"/><text class="flow-text" x="195" y="85">P1</text>
<rect class="flow-box phase2" x="270" y="60" width="90" height="40" rx="8"/><text class="flow-text" x="315" y="85">P2</text>
<rect class="flow-box phase3" x="390" y="60" width="90" height="40" rx="8"/><text class="flow-text" x="435" y="85">P3</text>
<rect class="flow-box phase3" x="510" y="60" width="90" height="40" rx="8"/><text class="flow-text" x="555" y="85">P4</text>
<rect class="flow-box phase4" x="630" y="60" width="90" height="40" rx="8"/><text class="flow-text" x="675" y="85">P5 down</text>

<text class="flow-label" x="315" y="42" text-anchor="middle">1. P2 initiates election</text>
<path class="flow-arrow" d="M360,72 C420,26 500,26 550,58" marker-end="url(#f3c)"/>
<path class="flow-arrow" d="M360,88 C420,120 500,120 550,100" marker-end="url(#f3c)"/>
<text class="flow-label" x="455" y="150" text-anchor="middle">2. P3 and P4 answer OK</text>

<text class="flow-label" x="435" y="180" text-anchor="middle">3. P3 and P4 each start their own election</text>
<path class="flow-arrow" d="M600,72 C650,30 690,30 690,54" marker-end="url(#f3c)"/>
<text class="flow-label" x="672" y="24" text-anchor="middle">4. P5 does not answer</text>

<text class="flow-label" x="555" y="212" text-anchor="middle">5. P4 receives no reply and announces itself coordinator</text>
<path class="flow-arrow" d="M510,214 H130" marker-end="url(#f3c)"/>
<path class="flow-arrow" d="M510,214 H130" marker-end="url(#f3c)"/>
<text class="flow-label" x="320" y="236" text-anchor="middle">coordinator message to every process (P5 excluded &mdash; it is not answering)</text>

<text class="flow-label" x="400" y="272" text-anchor="middle">When P5 recovers it runs the algorithm immediately and, having the highest number,</text>
<text class="flow-label" x="400" y="294" text-anchor="middle">bullies P4 out of the coordinator role even though P4 is working fine.</text>
</svg>
<figcaption><strong>Fig 3.3 &mdash; The Bully algorithm's five steps</strong>, following the deck's slide 75 (P2 initiates, P2 receives replies, P3 and P4 initiate, P3 receives a reply, P4 receives none and announces itself) and its second worked example on slides 79&ndash;80 (process 4 holds an election, 5 and 6 respond and tell 4 to stop, 5 and 6 each hold an election, 6 tells 5 to stop, 6 wins and tells everyone).</figcaption>
</figure>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s79-065.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s79-065.webp" alt="Bully Algorithm: Example (2)" width="1127" height="416" loading="lazy" decoding="async">
<figcaption><strong>slide 79</strong> &middot; Ch_3_Sync_and_Cordn.pptx &mdash; Bully Algorithm: Example (2)</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s80-066.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s80-066.webp" alt="Bully Algorithm: Example (2)" width="746" height="393" loading="lazy" decoding="async">
<figcaption><strong>slide 80</strong> &middot; Ch_3_Sync_and_Cordn.pptx &mdash; Bully Algorithm: Example (2)</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>3.4.3 The Ring algorithm (Chang and Roberts)</h3>
<p>Chang and Roberts is <strong>a ring-based election algorithm used to find the process with the largest identification</strong>. It is <strong>a useful method of election in decentralized distributed computing where the systems are connected in a logical or physical ring</strong>. It <strong>works for any number of processes N, and does not require any process to know how many processes are in the ring</strong> &mdash; which is its main advantage over the Bully algorithm's assumption that everyone can reach everyone.</p>

<p><strong>Assumptions:</strong> the system is organized as a ring, logically or physically; <strong>the links are unidirectional and processes send their messages to their right neighbours</strong>; and <strong>each process maintains an active list, consisting of the priority numbers of all active processes in the system when the algorithm ends</strong>.</p>
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s83-067.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s83-067.webp" alt="Diagram from Ch_3_Sync_and_Cordn.pptx, slide 83" width="608" height="369" loading="lazy" decoding="async">
<figcaption><strong>slide 83</strong> &middot; Ch_3_Sync_and_Cordn.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch3/ch-3-sync-and-cordn-s83-068.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch3/ch-3-sync-and-cordn-s83-068.webp" alt="Diagram from Ch_3_Sync_and_Cordn.pptx, slide 83" width="755" height="552" loading="lazy" decoding="async">
<figcaption><strong>slide 83</strong> &middot; Ch_3_Sync_and_Cordn.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p><strong>The algorithm in the deck's second formulation</strong> (slide 85&ndash;86), which is the clearest one to reproduce:</p>
<ol>
<li><strong>Initially each process in the ring is marked as non-participant.</strong></li>
<li><strong>A process that notices a lack of leader starts an election</strong>, creating an election message containing <strong>its own UID</strong> and sending it <strong>clockwise to its neighbour</strong>.</li>
<li><strong>Every time a process sends or forwards an election message it marks itself as a participant.</strong></li>
<li>When a process receives an election message it <strong>compares the UID in the message with its own UID</strong>, and answers in one of these ways:
<ul>
<li><strong>If the UID in the message is larger, it unconditionally forwards the message clockwise.</strong></li>
<li><strong>If the UID in the message is smaller and the process is not yet a participant, it replaces the UID in the message with its own UID</strong> and sends the updated message clockwise.</li>
<li><strong>If the UID in the message is smaller and the process is already a participant, it discards the election message.</strong></li>
<li><strong>If the UID in the incoming message is the same as the process's own UID, that process starts acting as the leader.</strong></li>
</ul>
</li>
<li><strong>The leader then begins the second phase:</strong> it marks itself as <strong>non-participant</strong> and sends an <strong>elected message</strong> to its neighbour announcing its election and UID.</li>
<li><strong>When a process receives an elected message</strong> it marks itself <strong>non-participant</strong>, <strong>records the elected UID</strong>, and <strong>forwards the elected message unchanged</strong>.</li>
<li><strong>When the elected message reaches the newly elected leader, the leader discards it and the election is over.</strong></li>
</ol>

<p>The deck's earlier formulation of the same algorithm is useful as a summary of the message contents: the election message <strong>circulates around the ring bypassing failed nodes</strong>, and <strong>each node appends its id to the message as it passes it on</strong>; when the message returns to the initiator, <strong>it elects the node with the best election attribute value</strong> and sends a <strong>coordinator</strong> message with the new coordinator's id, which again accumulates ids as it circulates. <strong>Once the coordinator message returns to the initiator, the election is over if the coordinator is in the id-list; otherwise the algorithm is repeated</strong> &mdash; which is how a failed election is handled.</p>

<div class="concept-box tip">
<h4>The failure case both ring examples are testing</h4>
<p>The deck's first ring example is worth reading closely, because it shows the algorithm surviving a candidate that dies mid-election: P2 initiates, the election message gathers <strong>{2, 3, 4}</strong>, P2 <strong>selects 4</strong> and announces it &mdash; and then <strong>P4 dies</strong>, so when the coordinator message comes back to P2 the list does not include 4. <strong>P2 re-initiates the election, and P3 is finally elected.</strong> That "if the coordinator is not in the id-list, repeat" step is the whole reason the ring algorithm tolerates failure during the election, and it is the detail that separates a full-mark answer from a partial one.</p>
</div>

<p>The second example is the standard six-process walkthrough: <strong>six processes in a logical ring with P6 as leader; P6 fails; P3 notices P6 does not respond and starts an election, sending its id to the next node</strong>; each of P5, P0, P1 and P4 <strong>passes the message on, adding its own id</strong>; when the message returns to P3 it recognises its own id in the list, <strong>picks the highest id (5) and sends "5 is the leader" around the ring</strong>, where each process passes on the coordinator message until it reaches P3, which stops it.</p>

<h3>3.4.4 Bully versus Ring &mdash; the comparison an exam answer wants</h3>
<table class="comparison-table">
<thead>
<tr><th></th><th>Bully algorithm</th><th>Ring (Chang and Roberts) algorithm</th></tr>
</thead>
<tbody>
<tr><td><strong>Topology assumed</strong></td><td>Every process can send a message to every other process (the deck's example is a mesh).</td><td>The processes are organized as a logical or physical ring, with unidirectional links to the right neighbour.</td></tr>
<tr><td><strong>Who can be elected</strong></td><td>The active process with the <strong>largest process ID</strong>.</td><td>The process with the <strong>largest identification</strong> (UID) &mdash; the same criterion.</td></tr>
<tr><td><strong>Messages</strong></td><td>Election messages to <em>all higher-numbered</em> processes, answers from those that are alive, then a victory broadcast. A process may restart the algorithm when it gets no follow-up within T&prime;.</td><td>One election message that travels the ring accumulating ids, then one coordinator message that travels the ring again. <strong>Two laps</strong> in the normal case.</td></tr>
<tr><td><strong>Knowledge required</strong></td><td>Each process must know the identifiers of higher-numbered processes and be able to reach them.</td><td><strong>No process needs to know how many processes are in the ring</strong>, and it works for any N.</td></tr>
<tr><td><strong>How failure is handled</strong></td><td>Time-outs (T for the coordinator, T&prime; for a higher process to announce itself) determine staleness, then the process restarts the algorithm.</td><td>Failed nodes are <strong>bypassed</strong> as the message circulates; if the elected candidate turns out to be dead, the initiator <strong>repeats the election</strong> when the coordinator message returns without it.</td></tr>
<tr><td><strong>Characteristic behaviour</strong></td><td>A recovered high-numbered process immediately <strong>bullies</strong> the current coordinator out of the role.</td><td>Fully decentralized; the election is driven by whoever notices the failure.</td></tr>
</tbody>
</table>

<div class="concept-box tip">
<h4>The paper-facing part of this unit</h4>
<p>Everything in this unit that is written to be answered in the exam &mdash; what each question asks for, and the model answer to it &mdash; is collected in <a href="#/ch/3/past">Past Questions</a>. Read this tab for the subject; switch to that one when you sit down to answer a question.</p>
</div>
`,

  pastSummary: `<h2>Exam-facing summary</h2>
<table class="comparison-table">
<thead>
<tr><th>If the question says&hellip;</th><th>Give&hellip;</th></tr>
</thead>
<tbody>
<tr><td>List two clock synchronization algorithms (2 marks)</td><td>Cristian's algorithm and NTP (physical) &mdash; or Lamport timestamps and vector clocks (logical). Add which family each belongs to.</td></tr>
<tr><td>Explain Cristian's algorithm</td><td>Time server with a radio clock / UTC source; client requests the time, server appends T, client sets its clock to <strong>T + RTT/2</strong>; the worked example; accuracy <strong>&plusmn;RTT/2</strong>, improved to <strong>(RTT/2 &minus; min)</strong> by using the shortest of several round trips.</td></tr>
<tr><td>Explain NTP</td><td>Port 123, UDP, 64-bit timestamp in UTC seconds since 1 Jan 1900 with 200 ps resolution; strata and the synchronization subnet; the three modes (multicast, RPC, symmetric); and the offset formula <strong>&theta; = [(T2 &minus; T1) + (T3 &minus; T4)]/2</strong> with the four timestamps named.</td></tr>
<tr><td>Explain Lamport's logical clock with an example (4 marks)</td><td>The three rules, Fig 3.2, and the limitation: <strong>a &rarr; b implies ts(a) &lt; ts(b), but not the converse</strong>.</td></tr>
<tr><td>Why do we need vector clocks?</td><td>Because Lamport timestamps give false positives &mdash; <code>LC(e1) &lt; LC(e2)</code> can hold for concurrent events, so concurrent updates may be ordered unnecessarily; a vector clock is necessary and sufficient, since non-dominating vectors prove concurrency.</td></tr>
<tr><td>Explain mutual exclusion in distributed systems</td><td>The definitions (critical section, race condition, mutual exclusion), the four requirements (safety, liveness, no starvation, fairness), and the two approaches with their named algorithms.</td></tr>
<tr><td>Explain the Ricart&ndash;Agrawala algorithm</td><td>The improvement over Lamport, the REQUEST/REPLY rules including the deferred requests, 2(n&minus;1) messages, no FIFO requirement, and reply-on-release.</td></tr>
<tr><td>Explain the Token Ring algorithm</td><td>Logical ring unrelated to the physical topology, one token, retain on entry and pass clockwise after leaving, itself passed on when unwanted, and the problems: 1 to n&minus;1 messages, idle traffic, failure requiring reconfiguration, and token regeneration needing an election.</td></tr>
<tr><td>Describe the Bully election algorithm (8 marks)</td><td>Purpose and assumptions (synchronous, time-out failure detection, largest ID wins), the three message types, the four basic steps and the detailed T / T&prime; version, Fig 3.3, <strong>why it is called Bully</strong>, recovery behaviour, and applications (clock synchronization/leader, central coordinator replacement, token regeneration, and master selection in any decentralized computation).</td></tr>
<tr><td>Compare Bully and Ring</td><td>The table in 3.4.4 &mdash; topology, message pattern, knowledge required, and failure handling.</td></tr>
</tbody>
</table>


`,

  quiz: [
    {
      q: 'In Cristian\'s algorithm, what does the client set its clock to?',
      options: [
        'T, the timestamp the server sent',
        'T + RTT/2, where RTT is the round-trip time of its own request',
        'T &minus; RTT, correcting for the reply delay',
        'The average of T and the client\'s own clock'
      ],
      answer: 1,
      explanation: 'The server appends the time T from its own clock, and the client sets its time to T + RTT/2. The method assumes the RTT is split equally between request and response — a reasonable assumption on a LAN — and its accuracy is ±RTT/2, improved to (RTT/2 − min) by keeping the response with the shortest RTT.'
    },
    {
      q: 'A Cristian\'s-algorithm client sends its request at 5:08:15.100 and receives the reply at 5:08:15.900; the reply carried 5:09:25.300. What should it set its clock to?',
      options: [
        '5:09:25.300',
        '5:08:15.900',
        '5:09:25.700',
        '5:09:24.900'
      ],
      answer: 2,
      explanation: 'RTT = 5:08:15.900 − 5:08:15.100 = 800 ms, so the timestamp is estimated to be 400 ms old: clock = 5:09:25.300 + 400 ms = 5:09:25.700. This is the deck\'s own worked example.'
    },
    {
      q: 'The accuracy of Cristian\'s algorithm, when min is the minimum one-way transmission time, is:',
      options: [
        'RTT/2',
        'RTT &minus; min',
        'RTT/2 &minus; min',
        'min'
      ],
      answer: 2,
      explanation: 'The server\'s time when the message reaches the client lies in the range (T + min) to (T + RTT − min); that range is (RTT − 2·min) wide, which gives an accuracy of (RTT/2 − min).'
    },
    {
      q: 'How long is an NTP timestamp, and what does it represent?',
      options: [
        'A 32-bit count of seconds since 1 Jan 1970 with millisecond resolution',
        'A 64-bit timestamp in UTC seconds since 1 Jan 1900 with a resolution of 200 picoseconds',
        'A 64-bit count of microseconds since the machine booted',
        'A 128-bit UUID with a sequence number'
      ],
      answer: 1,
      explanation: 'Time servers listen on port 123 and reply with a UDP/IP packet in NTP format: a 64-bit timestamp in UTC seconds since 1 Jan 1900 with 200 picosecond resolution. This is one of the recovered picture labels from the deck\'s NTP slide.'
    },
    {
      q: 'Which NTP mode is used to synchronize between the time servers themselves?',
      options: [
        'Multicast',
        'Remote procedure call',
        'Symmetric mode',
        'Broadcast'
      ],
      answer: 2,
      explanation: 'Symmetric mode gives high accuracy and is used peer-to-peer between time servers. Multicast is for quick LANs at low accuracy, and the RPC mode — where the server replies to a client request with its timestamp — gives medium accuracy and is the one like Cristian\'s algorithm.'
    },
    {
      q: 'In the NTP exchange where A sends at T1, B receives at T2, B responds at T3 and A receives at T4, the offset is:',
      options: [
        '(T4 &minus; T1) &minus; (T3 &minus; T2)',
        '[(T2 &minus; T1) + (T3 &minus; T4)] / 2',
        'T3 &minus; T1',
        '(T4 &minus; T3) / 2'
      ],
      answer: 1,
      explanation: 'The total transit time is (T4 − T1) − (T3 − T2) — elapsed time minus the server\'s processing time — and half of it is the one-way delay. Substituting that gives B\'s clock at T4 as [(T4 − T1) + (T2 + T3)]/2, so the difference θ = [(T2 − T1) + (T3 − T4)]/2.'
    },
    {
      q: 'Which statement about Lamport timestamps is TRUE?',
      options: [
        'If ts(a) < ts(b) then a happened before b',
        'If a happened before b then ts(a) < ts(b)',
        'Lamport timestamps can detect whether two events are concurrent',
        'Lamport timestamps give the real time of each event'
      ],
      answer: 1,
      explanation: 'The implication runs one way only. a → b implies ts(a) < ts(b), but ts(a) < ts(b) does not prove a → b — concurrent events can carry any two values. Detecting genuine concurrency is exactly what vector clocks add.'
    },
    {
      q: 'On receiving a message, a process using Lamport\'s algorithm sets its counter to:',
      options: [
        'its own value plus one',
        'the received value plus one',
        'one more than the maximum of its own value and the received value',
        'the maximum of its own value and the received value'
      ],
      answer: 2,
      explanation: 'Rule 3 of Lamport\'s algorithm: the receiver sets its counter to be greater than the maximum of its own value and the received value before it considers the message received. That is what "resynchronizes its logical clock with that sender" means.'
    },
    {
      q: 'Why are vector clocks needed in addition to Lamport timestamps?',
      options: [
        'Because Lamport timestamps cannot be stored in 32 bits',
        'Because Lamport timestamps give false positives — LC(e1) < LC(e2) can hold for concurrent events, so concurrent updates may be ordered unnecessarily',
        'Because Lamport timestamps require synchronized physical clocks',
        'Because vector clocks use less memory'
      ],
      answer: 1,
      explanation: 'The converse of the clock condition does not hold for Lamport clocks, so a smaller timestamp does not mean "happened before". Vector clocks are necessary and sufficient for capturing causality: two non-dominating vectors prove the events are concurrent.'
    },
    {
      q: 'The improvement in Ricart-Agrawala over Lamport\'s mutual exclusion algorithm is:',
      options: [
        'It uses a token instead of messages',
        'A node with a lower request timestamp need not send a REPLY, since the requester cannot enter before it anyway',
        'It requires FIFO channels, which makes it faster',
        'It elects a coordinator and asks only that node'
      ],
      answer: 1,
      explanation: 'That is the stated main idea: node j need not send a REPLY to node i if j has a request with a lower timestamp than i\'s request. The properties are 2(n−1) messages per critical-section invocation, no FIFO requirement, a synchronization delay of one maximum message transmission time, and requests granted in increasing timestamp order.'
    },
    {
      q: 'In the Token Ring mutual exclusion algorithm, when a process receives the token but does not need the critical section, it:',
      options: [
        'holds the token until it needs it',
        'immediately passes the token on along the ring',
        'destroys the token so it can be regenerated later',
        'sends a reply message to the last requester'
      ],
      answer: 1,
      explanation: 'A process that wants the section waits for the token from its left neighbour and retains it; after leaving the section it passes the token clockwise. A process that does not want it passes it on immediately — which is why the ring carries traffic even when nobody needs the section, and why the algorithm works poorly under light load.'
    },
    {
      q: 'What has to happen if the process holding the token fails in the Token Ring algorithm?',
      options: [
        'Nothing — the token is duplicated automatically',
        'A unique process has to be picked to regenerate the token, which requires running an election algorithm',
        'The whole system must be restarted',
        'The ring must be rebuilt physically'
      ],
      answer: 1,
      explanation: 'If a process fails, no progress can be made until a reconfiguration extracts it from the ring; if the token holder fails, a unique process must be picked to regenerate the token and pass it along — an election algorithm has to be run for that purpose. This is the direct link between mutual exclusion and election algorithms.'
    },
    {
      q: 'In the Bully algorithm, why is a process with a higher ID able to displace an existing coordinator?',
      options: [
        'Because it has a faster clock',
        'Because a recovered or higher-numbered process immediately begins the algorithm and forces lower-numbered processes to let it become coordinator, even if one is already active',
        'Because the current coordinator resigns on receiving any election message',
        'Because the time-out T is shorter for higher-numbered processes'
      ],
      answer: 1,
      explanation: 'After a failed process recovers it immediately begins execution of the algorithm, and if there are no active processes with higher numbers it forces all lower-numbered processes to let it become coordinator — even if there is currently an active coordinator with a lower number. That is how the algorithm gets its name.'
    },
    {
      q: 'Which message types does the Bully algorithm use?',
      options: [
        'REQUEST, REPLY, RELEASE',
        'Election, Answer, Coordinator',
        'Token, Elected, Coordinator',
        'Probe, Ack, Broadcast'
      ],
      answer: 1,
      explanation: 'Election (announce an election), Answer (respond to an election — the "I am alive" reply) and Coordinator (announce the elected process). REQUEST/REPLY belong to Ricart-Agrawala, and the Ring algorithm uses election and elected/coordinator messages that accumulate ids.'
    },
    {
      q: 'What is the two-phase structure that every election algorithm shares?',
      options: [
        'First detect a failure, then broadcast a time-out',
        'First select the leader with the highest priority, then inform all processes about the winner',
        'First build the ring, then circulate the token',
        'First request permission from all nodes, then enter the critical section'
      ],
      answer: 1,
      explanation: 'An election process is typically performed in two phases: select a leader with the highest priority, then inform all processes about the winner. The Ring algorithm makes this explicit — one lap with the election message, one lap with the coordinator message.'
    },
    {
      q: 'Which is an advantage of the Ring (Chang and Roberts) election algorithm over Bully?',
      options: [
        'It elects the coordinator faster in all cases',
        'It does not require any process to know how many processes are in the ring',
        'It does not need process identifiers',
        'It works without any messages'
      ],
      answer: 1,
      explanation: 'Chang and Roberts works for any number of processes N and does not require any process to know how many are in the ring, and it needs only unidirectional links. Bully assumes a system where every process can send a message to every other process and each knows who has a higher identifier.'
    }
  ],

  past: [
    {
      year: 'Final 2025',
      marks: '2',
      repeats: 1,
      q: 'List any two mutual exclusion algorithms.',
      occ: [
        { year: 'Final 2025', marks: '2', q: 'List any two mutual exclusion algorithms.' }
      ],
      answer: `
<h4>Model answer &mdash; 2 marks</h4>
<p>Any two of the classic distributed mutual-exclusion algorithms earn the marks. The
three that are examinable here, with one line each:</p>
<ul>
<li><strong>Centralized (coordinator) algorithm</strong> &mdash; one process holds the token. A
process wanting the critical section sends a request to the coordinator and waits for the
token; the coordinator grants it to one process at a time and queues the rest. Simple,
but the coordinator is a single point of failure and a bottleneck.</li>
<li><strong>Ricart&ndash;Agrawala (distributed, timestamp-based)</strong> &mdash; there is no
coordinator. A process broadcasts a request stamped with its Lamport time and enters only
when every other process has replied. A process defers its reply if it is itself waiting
and its own request has a smaller timestamp, which is where the total ordering does the
work.</li>
<li><strong>Token-ring (ring) algorithm</strong> &mdash; the N processes form a logical ring
and one token circulates; holding the token is permission to enter. It needs no
coordination traffic when idle, but a lost token stops progress until it is regenerated.</li>
</ul>
<div class="concept-box tip">
<h4>What earns the second mark</h4>
<p>Naming two is the first mark. The second comes from one clause that shows you know what
the algorithm <em>does</em> rather than which word it is &mdash; "the coordinator is a single
point of failure" or "requests are ordered by Lamport timestamp" is enough. This was Group A
question 2 of the <em>2025 Final Exam</em>, worth 2 marks, so it is a one-line answer and the
cheapest mark on this unit's part of that paper.</p>
</div>
`
    },
    {
      year: 'Model 2025',
      marks: '2',
      repeats: 1,
      q: 'List any two clock synchronization algorithms used in distributed systems.',
      occ: [
        { year: 'Model 2025', marks: '2', q: 'List any two clock synchronization algorithms used in distributed systems.' }
      ],
      answer: `
<h4>Model answer &mdash; 2 marks</h4>
<p>Clock synchronization algorithms fall into two families, and either pair below is a correct answer:</p>
<ul>
<li><strong>Physical clock synchronization</strong> &mdash; the clocks themselves are moved toward real time (UTC):
  <ul>
  <li><strong>Cristian's algorithm</strong> (centralized): the client requests the time from a time server, which appends its own timestamp T, and the client sets its clock to <strong>T + RTT/2</strong>.</li>
  <li><strong>Network Time Protocol (NTP)</strong> (distributed): servers listen on port 123 and reply with a 64-bit timestamp; clients average updates from several servers and the protocol arranges servers in strata.</li>
  </ul>
</li>
<li><strong>Logical clock synchronization</strong> &mdash; no physical time, only causal order:
  <ul>
  <li><strong>Lamport timestamps</strong>: a monotonically increasing software counter, incremented at each event and carried on messages, resynchronized by the receiver to one more than the maximum of the two values.</li>
  <li><strong>Vector clocks</strong>: an array of N logical clocks, one per process, exchanged in full with every message, which detects genuine concurrency.</li>
  </ul>
</li>
</ul>
<p>Two from either family is a complete answer; naming both families and one algorithm from each is stronger and costs one extra line.</p>

<div class="concept-box tip">
<h4>Where this came from</h4>
<p>Group A, question 3 of the <em>Model Question 2025</em>. Group A questions are 2 marks each (<code>2*4 = 8</code>), so this expects two names, not an explanation &mdash; but the two families are the distinction the syllabus draws in 3.1 and 3.2, so showing it is cheap and safe.</p>
</div>`
    },
    {
      year: 'Model 2025',
      marks: '4',
      repeats: 1,
      q: "Explain Lamport's logical clock with a suitable example.",
      occ: [
        { year: 'Model 2025', marks: '4', q: "Explain Lamport's logical clock with a suitable example." }
      ],
      answer: `
<h4>Model answer &mdash; 4 marks</h4>
<p><strong>Why it is needed.</strong> There is no common memory and no common clock in a distributed system, so it is sometimes impossible to say which of two events occurred first. Physical clocks drift and cannot be synchronised perfectly. A <strong>logical clock</strong> &mdash; invented by Lamport (1978) &mdash; is a mechanism by which the <strong>happened-before ordering is captured numerically</strong>. It is a <strong>monotonically increasing software counter whose value need bear no particular relationship to any physical clock</strong>: it is adequate that all machines agree it is 10:00 even if it is really 10:02, because what matters is internal consistency, not closeness to real time.</p>

<p><strong>Definition of happened-before.</strong> A &rarr; B if A and B are in the same process and A executed first; A &rarr; B if A is the sending of a message and B its receipt; and the relation is transitive. Events not related by &rarr; are <strong>concurrent</strong>. A timestamping scheme must guarantee that <strong>if A &rarr; B then ts(A) &lt; ts(B)</strong>.</p>

<p><strong>The algorithm.</strong> Each process p<sub>i</sub> keeps its own counter L<sub>i</sub>:</p>
<ol>
<li><strong>A process increments its counter before each event in that process.</strong></li>
<li><strong>When a process sends a message, it includes its counter value with the message.</strong></li>
<li><strong>On receiving a message, the receiver sets its counter to be greater than the maximum of its own value and the received value, before it considers the message received.</strong></li>
</ol>
<p>Conceptually the clock has meaning only in relation to messages moving between processes: when a process receives a message it <strong>resynchronizes its logical clock with that sender</strong>. In the middleware, the local clock is adjusted and the message timestamped before the network layer sends it.</p>

<p><strong>Example.</strong> Three processes p1, p2, p3 (Fig 3.2). p1 performs an event (counter 1), then another (counter 2) and sends a message carrying 2; p2, whose counter is 1, receives it and sets its counter to <strong>max(1, 2) + 1 = 3</strong>; p2 sends a message carrying 3 to p3, which sets its counter to <strong>max(1, 3) + 1 = 4</strong>, and so on. Every counter along a process increases, and each receive event carries a value strictly greater than the message's value &mdash; so rule 2 of happened-before is satisfied numerically.</p>

<p><strong>The limitation (needed for full marks).</strong> The guarantee is one-directional: <strong>ts(A) &lt; ts(B) does not imply A &rarr; B</strong>. Two concurrent events can carry 3 and 7 with no causal link. So Lamport clocks give a consistent total order, but they <strong>do not capture causality violations</strong> &mdash; if we know A &rarr; C and B &rarr; C we cannot say which of A or B initiated C, which matters when replaying events to recover a node after a crash. Two practical requirements follow: the clock must tick at least once between two events of the same process so that <code>C(a)</code> never equals <code>C(b)</code>, and in a multithreaded environment the process ID should be attached to the timestamp.</p>

<div class="concept-box tip">
<h4>Where this came from</h4>
<p>Group B, question 8 of the <em>Model Question 2025</em>, worth 4 marks. The question says "with a suitable example", so the example is compulsory — draw the three-process timeline and label the counter values, then state the one-directional limitation. The limitation is what most answers omit.</p>
</div>`
    },
    {
      year: 'Model 2025',
      marks: '8',
      repeats: 2,
      q: 'Describe in detail the working and applications of the Bully election algorithm.',
      occ: [
        { year: 'Model 2025', marks: '8', q: 'Describe in detail the working and applications of the Bully election algorithm.' },
        { year: 'Final 2025', marks: '8', q: 'Explain the Bully Election Algorithm with an example and event sequence.' }
      ],
      answer: `
<h4>Model answer &mdash; 8 marks</h4>
<p><strong>1. Purpose.</strong> In distributed computing, <strong>leader election is the process of designating a single process as the organizer of a task distributed among several nodes</strong>. Before the task begins, no node knows which will lead; after the algorithm has run, <strong>every node recognizes the same unique node as leader</strong>. The Bully algorithm is <strong>a method for dynamically selecting a coordinator by process ID number</strong>, applicable to a system in which <strong>every process can send a message to every other process</strong> (a mesh, for example).</p>

<p><strong>2. Assumptions.</strong> The system is <strong>synchronous</strong>, and <strong>failure is detected by time-out</strong>. A <strong>unique priority number</strong> is associated with each active process (process P<sub>i</sub> has number <em>i</em>), there is a one-to-one correspondence between processes and sites, and <strong>the coordinator is always the active process with the largest priority number</strong>. It does not matter <em>which</em> process is elected; what matters is that <strong>exactly one is chosen and all processes agree on the decision</strong>. Each process knows which processes have higher identifiers and communicates with them.</p>

<p><strong>3. Message types.</strong> <strong>Election</strong> (sent to announce an election), <strong>Answer</strong> (sent to respond to an election message) and <strong>Coordinator</strong> (sent to announce the identity of the elected process).</p>

<p><strong>4. Working &mdash; basic steps.</strong> When a process P determines that the current coordinator is down, because of message time-outs or a failure to initiate a handshake:</p>
<ol>
<li><strong>P broadcasts an election message (inquiry) to all other processes with higher process IDs.</strong></li>
<li><strong>If P hears from no process with a higher ID than itself, it wins the election and broadcasts victory.</strong></li>
<li><strong>If P hears from a process with a higher ID, P waits a certain time for that process to broadcast itself as leader. If that message does not arrive in time, P re-broadcasts the election message.</strong></li>
<li><strong>If P receives an election message from a process with a lower ID, it sends an "I am alive" answer and starts a new election.</strong></li>
</ol>

<p><strong>5. The detailed rules with the two time-outs.</strong> If P<sub>i</sub>'s request is not answered by the coordinator within interval <strong>T</strong>, it assumes the coordinator has failed and attempts to elect itself: it sends an election message to every process with a higher number and <strong>waits for an answer within T</strong>. If no response comes within T, it assumes every higher-numbered process has failed and <strong>elects itself coordinator</strong>. If an answer is received, it starts interval <strong>T&prime;</strong> waiting for news that a higher-numbered process has been elected; if nothing arrives within T&prime;, it restarts the algorithm. Meanwhile, if it receives "P<sub>j</sub> is the new coordinator (j &gt; i)" it records it; if it receives "P<sub>j</sub> started an election (j &gt; i)" it answers and begins its own election, provided it has not already started one.</p>

<p><strong>6. Worked example (Fig 3.3).</strong> Six processes P0&ndash;P5; the coordinator fails. <strong>P2 initiates an election</strong> and receives replies from P3 and P4; <strong>P3 and P4 each initiate their own elections</strong>; P3 receives a reply, but <strong>P4 receives no reply from P5 (which is down) and announces itself coordinator</strong>. With the deck's other example: process 4 holds an election, 5 and 6 respond and tell 4 to stop, 5 and 6 each hold an election, <strong>6 tells 5 to stop, 6 wins and tells everyone</strong>.</p>

<p><strong>7. Why it is called the Bully algorithm.</strong> Because <strong>if a process receives a victory message from a process with a lower ID number, it immediately initiates a new election</strong>: a process with a higher number <strong>bullies</strong> a lower-numbered process out of the coordinator position as soon as it comes online. Correspondingly, <strong>after a failed process recovers it immediately begins the same algorithm</strong>, and <strong>if there is no active process with a higher number it forces all lower-numbered processes to let it become coordinator, even if there is currently an active coordinator with a lower number</strong>.</p>

<p><strong>8. Applications.</strong> Every distributed algorithm that needs one process to act as coordinator uses an election:</p>
<ul>
<li><strong>Clock synchronization</strong> &mdash; the Berkeley algorithm needs a leader or master to take responsibility for averaging the time.</li>
<li><strong>Mutual exclusion</strong> &mdash; the <em>central coordinator based</em> algorithm needs a new coordinator elected at initialization or <strong>whenever the coordinator crashes</strong>; the <em>token ring</em> algorithm needs one when <strong>the process holding the token fails</strong>, so that a unique process regenerates the token.</li>
<li><strong>Any distributed computing</strong> &mdash; a distributed algorithm does not assume the existence of a central coordinator, so a master must be selected to <strong>distribute sub-problems among the slaves and collect the partial results</strong>.</li>
<li>In practice the same mechanism is what a replicated service uses to pick its primary, and what a distributed system uses after a crash to decide where a new copy of the coordinator should be restarted.</li>
</ul>

<p><strong>9. Contrast in one line (optional).</strong> The Ring (Chang and Roberts) algorithm is the alternative: it assumes only a logical ring with unidirectional links, needs no process to know how many processes exist, circulates one election message that accumulates identifiers, and repeats the election if the chosen candidate turns out to have failed.</p>

<div class="concept-box tip">
<h4>Where this came from</h4>
<p>Group C, question 14 of the <em>Model Question 2025</em>, worth 8 marks &mdash; Group C questions carry two parts of 4 marks each, and this one asks for two things: the <strong>working</strong> and the <strong>applications</strong>. Answer in that shape, with Fig 3.3 drawn for the example and the four applications listed by name.</p>
</div>`
    }
  ]
};

;
/* ch4.js */
/* Chapter 4 — Distributed File Systems and Middleware.

   Syllabus unit 4: 5 hours, 6 marks. Sub-topics 4.1 DFS concepts
   (Transparency, Naming, Replication, Consistency), 4.2 NFS, HDFS,
   4.3 Middleware: CORBA, Java RMI, Messaging MQTT, AMQP.

   Written from the course's own material, read into `_source/dcc/` by
   tools/dcc_extract.py:

     lecture_notes_all_chapterwise_chapter4_lecture_notes_all.txt
         Er. Avijit Karn's 41-slide Chapter 4 deck — DFS concepts and the file
         service architecture, SUN NFS, the DFS comparison table, heterogeneity,
         middleware and CORBA

     hdfs_note_4std_lecture.txt, gfs_hdfs_lecture.txt
         the HDFS note (design, blocks, namenodes and datanodes, NameNode
         failure, federation, high availability, failover and fencing) and the
         GFS/HDFS lecture (GFS assumptions, architecture, the read operation,
         master metadata, chunks)

     lecture_notes_all_chapterwise_ch4_messagingprotocol_mqtt_amqp_for_students.txt
         the MQTT/AMQP deck

   Where a fact comes from the recommended textbook rather than the class
   material it says so — notably the NFS consistency window, which the deck does
   not give a number for and Coulouris does. */

window.CHAPTERS = window.CHAPTERS || {};
window.CHAPTERS[4] = {
  learn: `

<h2>Unit 4 &mdash; Distributed File Systems and Middleware</h2>
<p class="unit-meta">Syllabus: 5 hours &middot; 6 marks &middot; sub-topics 4.1&ndash;4.3</p>

<p>Read the unit as one question answered at three levels. <strong>4.1</strong> defines what a distributed file system is and what consistency costs. <strong>4.2</strong> puts two real systems beside that definition &mdash; NFS, which chose simplicity and statelessness, and HDFS and GFS, which chose replication behind a single metadata server. <strong>4.3</strong> steps back to the layer all of them stand on, middleware, and names the families the syllabus expects you to recognise. The two exam questions in the box below sit at the two ends of it.</p>

<div class="concept-box asked">
<h4>What this unit is worth in the exam</h4>
<ul>
<li><strong>4 marks</strong> &mdash; &ldquo;Describe the concept of consistency in Distributed File Systems (DFS).&rdquo; (Group B, question 9 of the <em>Model Question 2025</em>)</li>
<li><strong>8 marks</strong> &mdash; &ldquo;Explain the architecture of HDFS. Discuss how it ensures fault tolerance and scalability. [4+4]&rdquo; (<em>Group C, question 16</em>)</li>
</ul>
<p>Twelve marks from a 6-mark unit. The Group C question is unusually specific about its two halves &mdash; <strong>architecture</strong> in 4 marks, then <strong>fault tolerance and scalability</strong> in 4 marks &mdash; and both halves are answered directly by 4.2 below, including the exact mechanisms (replication, the secondary namenode, federation, high availability). The consistency question is the one people lose marks on, because "consistency" sounds like it explains itself; 4.1.6 gives the definition, the reason it is hard, and the four things to name.</p>
</div>

<h2>4.1 Distributed File System concepts</h2>

<h3>4.1.1 What a DFS is</h3>
<p>A <strong>Distributed File System (DFS) is a classical model of a file system distributed across multiple machines</strong>, whose purpose is <strong>to promote the sharing of dispersed files</strong>. The deck's framing is worth keeping because it is precise about what is local and what is not: <strong>the resources on a particular machine are local to itself; resources on other machines are remote</strong>. A file system provides a service to clients, and the <strong>server interface is the normal set of file operations</strong> &mdash; create, read, and so on.</p>

<p>The defining property of a DFS: it <strong>enables programs to store and access remote files exactly as they do local ones, allowing users to access files from any computer on the network</strong>. Recent advances in the bandwidth of switched local networks and in disk organisation have produced <strong>high-performance, highly scalable file systems</strong>.</p>

<p>Configuration and implementation may vary, and three variations are named: <strong>servers may run on dedicated machines, or servers and clients can be on the same machines</strong>; <strong>the operating system itself can be distributed, with the file system a part of that distribution</strong>; and <strong>a distribution layer can be interposed between a conventional OS and the file system</strong>. In every case the requirement is the same: <strong>clients should view a DFS the same way they would a centralized file system &mdash; the distribution is hidden at a lower level</strong>. And the performance criterion is two numbers, not one: <strong>throughput and response time</strong>.</p>

<h3>4.1.2 The design goals &mdash; the list to open an answer with</h3>
<p>The deck lists eight DFS concepts, requirements or design goals. They are the standard skeleton of any DFS answer, so they are worth giving one line each rather than reciting:</p>

<table class="comparison-table">
<thead>
<tr><th>Goal</th><th>What it means in a DFS</th></tr>
</thead>
<tbody>
<tr><td><strong>Transparency</strong></td><td>The distribution is invisible: remote files are used exactly as local ones (see 4.1.3).</td></tr>
<tr><td><strong>Concurrency</strong></td><td>Many clients access and update files at the same time, and the system keeps them consistent.</td></tr>
<tr><td><strong>Replication</strong></td><td>Multiple copies of a file exist, for availability and performance (see 4.1.5).</td></tr>
<tr><td><strong>Heterogeneity</strong></td><td>Different hardware, operating systems and networks must interoperate &mdash; the property that 4.3's middleware exists to provide.</td></tr>
<tr><td><strong>Fault tolerance</strong></td><td>The service keeps working when machines, disks or networks fail.</td></tr>
<tr><td><strong>Consistency</strong></td><td>All readers see updates according to a defined rule, despite caching and replication (see 4.1.6 &mdash; this is the exam question).</td></tr>
<tr><td><strong>Security</strong></td><td>Access control and authentication apply to remote files as strictly as to local ones.</td></tr>
<tr><td><strong>Efficiency</strong></td><td>Throughput and response time close to a local file system's.</td></tr>
</tbody>
</table>

<h3>4.1.3 Transparency</h3>
<p>Transparency in a DFS is the family of properties introduced in Unit 1, applied to files. The strict form is <strong>access transparency</strong> &mdash; a client program issues the same operations on a remote file as on a local one and gets the same result &mdash; but a full answer names the others too: <strong>location</strong> (the client does not know where the file is), <strong>migration</strong> and <strong>relocation</strong> (the file may move, even while in use), <strong>replication</strong> (the client does not know how many copies exist), <strong>concurrency</strong> (others are using it), <strong>failure</strong> (a copy failed and was recovered), and <strong>persistence</strong> (memory or disk).</p>
<p>The design ambition, in the deck's words, is that <strong>in a transparent DFS the location of a file, somewhere in the network, is hidden</strong> &mdash; which is exactly what the naming schemes in 4.1.4 either deliver or fail to deliver. This is why NFS is described in the deck as having <strong>access transparency</strong> as its design goal while most other systems in its comparison table have something else.</p>

<h3>4.1.4 Naming &mdash; three schemes, and the mapping underneath</h3>
<p><strong>Naming is the mapping between logical and physical objects.</strong> Example: a user's filename maps to a physical location such as <code>&lt;cylinder, sector&gt;</code>. In a conventional file system that is understood as <em>where the file actually resides</em>, because the system and the disk are known. <strong>In a transparent DFS, the location of a file somewhere in the network is hidden</strong>, and if the file is replicated, <strong>the mapping returns a set of locations for the replicas</strong> rather than one.</p>

<p>There are <strong>three main approaches to naming files</strong>, and the trade-off between them is location transparency:</p>

<table class="comparison-table">
<thead>
<tr><th>#</th><th>Scheme</th><th>Transparency</th><th>Example</th></tr>
</thead>
<tbody>
<tr><td>1</td><td><strong>Files are named with a combination of host and local name.</strong></td><td>Guarantees a unique name, but is <strong>neither location transparent nor location independent</strong>. The same naming works on local and remote files, and the DFS is <strong>a loose collection of independent file systems</strong>.</td><td>A path naming the host explicitly.</td></tr>
<tr><td>2</td><td><strong>Remote directories are mounted to local directories.</strong> The local system then appears to have a coherent directory structure.</td><td>The files are <strong>location independent</strong> &mdash; but remote directories <strong>must be explicitly mounted</strong>.</td><td><strong>SUN NFS is the good example of this technique.</strong></td></tr>
<tr><td>3</td><td><strong>A single global name structure spans all the files in the system</strong>, and the DFS is built the same way as a local file system.</td><td>Location independent, with the strongest illusion of one system.</td><td>A single global namespace.</td></tr>
</tbody>
</table>

<p><strong>Implementation technique:</strong> the choice is between a <strong>non-transparent mapping</strong> (<code>name &rarr; &lt;system, disk, cylinder, sector&gt;</code>) and a <strong>transparent mapping</strong> (<code>name &rarr; file_identifier &rarr; &lt;system, disk, cylinder, sector&gt;</code>). The extra level is what buys transparency: <strong>when changing the physical location of a file, only the file identifier needs to be modified</strong>, so this identifier <strong>must be unique</strong>. That is the same idea as the <em>UFID</em> in 4.1.5's architecture and the same idea as the remote object reference in Unit 2.</p>

<p><strong>Mounting.</strong> <em>Mount</em> is the availability of files for users, made possible by the OS and storage services; <em>mounting</em> a file system <strong>attaches that file system to a directory (the mount point) and makes it available to the system</strong>. The <strong>root (/) file system is always mounted</strong>, and any other file system can be connected to or disconnected from it.</p>

<h3>4.1.5 The file service architecture</h3>
<p>An architecture that offers a clear separation of the main concerns in providing file access is obtained by structuring the file service into <strong>three components</strong>:</p>
<figure class="figure-wide figure-wrap">
<svg class="figure wide" viewBox="0 0 760 320" role="img" aria-label="File service architecture: application programs use a client module that wraps the flat file service and directory service; the directory service maps text names to UFIDs, and the flat file service performs operations on file contents addressed by UFID">
<defs><marker id="f4a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="flow-arrow-head"/></marker></defs>

<text class="flow-label" x="200" y="22" text-anchor="middle">Client computer</text>
<rect class="flow-box phase1" x="40" y="36" width="150" height="40" rx="8"/>
<text class="flow-text" x="115" y="61">Application program</text>
<rect class="flow-box phase1" x="220" y="36" width="150" height="40" rx="8"/>
<text class="flow-text" x="295" y="61">Application program</text>
<rect class="flow-box phase2" x="40" y="96" width="330" height="46" rx="9"/>
<text class="flow-text" x="205" y="124">Client module &mdash; one API for both services</text>
<text class="flow-label" x="205" y="160" text-anchor="middle">caches recently used file blocks &middot; knows server locations</text>

<text class="flow-label" x="600" y="22" text-anchor="middle">Server computer</text>
<rect class="flow-box phase3" x="480" y="36" width="240" height="46" rx="9"/>
<text class="flow-text" x="600" y="64">Directory service</text>
<text class="flow-label" x="600" y="100" text-anchor="middle">text name &harr; UFID</text>
<rect class="flow-box phase4" x="480" y="120" width="240" height="46" rx="9"/>
<text class="flow-text" x="600" y="148">Flat file service</text>
<text class="flow-label" x="600" y="184" text-anchor="middle">create, read, write, delete by UFID</text>

<path class="flow-arrow" d="M115,76 V92" marker-end="url(#f4a)"/>
<path class="flow-arrow" d="M295,76 V92" marker-end="url(#f4a)"/>
<path class="flow-arrow" d="M374,110 H476" marker-end="url(#f4a)"/>
<text class="flow-label" x="425" y="102" text-anchor="middle">lookup</text>
<path class="flow-arrow" d="M374,140 H476" marker-end="url(#f4a)"/>
<text class="flow-label" x="425" y="132" text-anchor="middle">operations</text>

<text class="flow-label" x="380" y="228" text-anchor="middle">A file has one UFID; its text name is only ever a directory-service mapping.</text>
<text class="flow-label" x="380" y="252" text-anchor="middle">UFIDs are long sequences of bits, chosen so that every file in the distributed system is unique.</text>
<text class="flow-label" x="380" y="276" text-anchor="middle">That is why a file can be renamed or moved without touching its contents.</text>
</svg>
<figcaption><strong>Fig 4.1 &mdash; The three components of the file service architecture</strong>, following the deck's slides 6&ndash;9. The client module <strong>implements the exported interfaces of the flat file and directory services on the server side</strong>, so an application sees one API: on UNIX hosts it emulates the full set of Unix file operations.</figcaption>
</figure>
<!-- dcc-fig:ch4/chapter4-lecture-notes-all-s07-071.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch4/chapter4-lecture-notes-all-s07-071.webp" alt="The Client module implements exported interfaces by flat file and directory services on server side." width="1092" height="501" loading="lazy" decoding="async">
<figcaption><strong>slide 7</strong> &middot; Chapter4_lecture_notes_all.pptx &mdash; The Client module implements exported interfaces by flat file and directory services on server side.</figcaption>
</figure>
<!-- /dcc-fig -->
<table class="comparison-table">
<thead>
<tr><th>Component</th><th>Responsibility</th></tr>
</thead>
<tbody>
<tr><td><strong>Flat file service</strong></td><td>Concerned with <strong>operations on the contents of files</strong>. <strong>Unique File Identifiers (UFIDs)</strong> are used to refer to files in all requests to it. UFIDs are <strong>long sequences of bits chosen so that each file is unique among all files in a distributed system</strong>.</td></tr>
<tr><td><strong>Directory service</strong></td><td>Provides the <strong>mapping between the text names of files and their UFIDs</strong>. Clients obtain a UFID by quoting its text name to the directory service. It also supports the functions needed to <strong>generate directories and add new files to directories</strong>.</td></tr>
<tr><td><strong>Client module</strong></td><td>Runs on each computer and <strong>provides the integrated flat-file and directory service as a single API to application programs</strong> &mdash; on UNIX hosts it emulates the full set of Unix file operations. It <strong>holds information about the network locations of the flat-file and directory server processes</strong>, and achieves better performance through <strong>a cache of recently used file blocks at the client</strong>.</td></tr>
</tbody>
</table>

<p>That last sentence is the hook into the consistency problem: <strong>every DFS on this syllabus caches at the client, and every consistency mechanism exists to bound how stale that cache may be</strong>.</p>

<h3>4.1.6 Consistency in a DFS &mdash; the exam question</h3>

<div class="concept-box key">
<h4>The definition to start with</h4>
<p><strong>Consistency is the requirement that when a file is replicated or cached, all clients that read a file observe the effects of updates according to a defined rule.</strong> It exists as a problem because a DFS keeps <strong>more than one copy</strong> of data &mdash; replicas on servers for availability, and cached blocks on clients for performance &mdash; so a write to one copy does not automatically reach the others. Consistency is the contract that says <em>how soon, and in what order</em>, it does.</p>
</div>

<p>Three facts make this unavoidable rather than optional, and naming them is most of a 4-mark answer:</p>
<ol>
<li><strong>Caching is mandatory for performance.</strong> The client module in 4.1.5 caches recently used file blocks; the DFS comparison table in the deck records a <em>cache consistency</em> strategy for every system in it &mdash; NFS, Coda, Plan 9 and xFS all choose <strong>write-back</strong>, SFS writes through. Write-back is faster and leaves a window in which the cache is wrong.</li>
<li><strong>Replication is mandatory for availability.</strong> The mapping for a replicated file returns a <em>set</em> of locations, so an update must either reach all replicas or be ordered so that readers can tell which copy is current.</li>
<li><strong>Concurrent access is normal.</strong> Concurrency is one of the eight design goals: several clients read and write the same file, so the rule must say what happens when they disagree.</li>
</ol>

<p>A good answer then states the two ends of the spectrum and says which systems sit where:</p>

<table class="comparison-table">
<thead>
<tr><th></th><th>Strict consistency</th><th>Relaxed / weaker consistency</th></tr>
</thead>
<tbody>
<tr><td><strong>Guarantee</strong></td><td>Every read sees the most recent write, immediately, everywhere.</td><td>Reads may see an older version for a <strong>bounded, defined period</strong> or until a defined event.</td></tr>
<tr><td><strong>What it requires</strong></td><td>Writes propagated synchronously to every copy before the write completes, and no client cache trusted.</td><td>Caching and replication with an explicit rule for when staleness ends.</td></tr>
<tr><td><strong>Cost</strong></td><td>Latency on every write proportional to the number of copies; poor throughput.</td><td>A consistency window in which different clients see different data.</td></tr>
<tr><td><strong>Where it appears in this syllabus</strong></td><td>Read-one/write-all replication, where a write must reach every copy before it is acknowledged (the <strong>ROWA</strong> entry in the deck's comparison table, under Coda's replication strategy).</td><td><strong>NFS</strong> (close-to-open, with a 30-second consistency window &mdash; see below), <strong>GFS and HDFS</strong> (write-once, append-only, relaxed while a file is being written).</td></tr>
</tbody>
</table>

<div class="concept-box tip">
<h4>NFS: close-to-open consistency, and the 30-second window</h4>
<p>NFS chooses relaxed consistency and states it precisely. Cached updates performed by an application <strong>are not visible to other processes until the file is closed</strong> &mdash; a <em>close-to-open</em> model, which lets a client batch its writes and flush them on close, and means a file that is open on two clients can show two different contents until one of them closes it. Coulouris (the course's first recommended textbook, Section 12.3) puts a number on the staleness: <strong>most NFS installations operate with a consistency window of 30 seconds between client and server</strong>, which is how long a client may keep using cached data before revalidating it with the server. The deck does not give the number; the textbook does, and quoting it is worth a mark.</p>
</div>

<p>Two further points finish the answer. First, <strong>consistency interacts with the failure model</strong>: NFS is stateless, so a client that crashes loses nothing and a server that crashes needs no recovery state &mdash; but a stateless server cannot remember that a client holds a file, which is exactly why NFS has <strong>no file locking</strong> and why its UNIX semantics are not perfectly preserved (4.2). Second, <strong>a cache consistency protocol is what makes caching safe</strong>, and the choice of protocol is the choice in the table above: write-back with revalidation, or write-through at the cost of performance.</p>

<h3>4.1.7 Replication</h3>
<p><strong>File replication means multiple copies of a file</strong>, and in a transparent DFS <strong>the naming mapping returns a set of locations for the replicas</strong>. Replication buys two different things and it is worth separating them:</p>
<ul>
<li><strong>Availability and fault tolerance</strong> &mdash; if one server or disk fails, another copy answers. This is the purpose in HDFS, where every block is replicated to <strong>typically three</strong> physically separate machines (4.2.4).</li>
<li><strong>Performance</strong> &mdash; a read can be served by the nearest or least-loaded replica, which is what the read-one/write-all scheme trades against write cost.</li>
</ul>
<p>The deck's comparison table records how each system handles it: NFS <strong>minimal</strong> replication with a <strong>client-based</strong> recovery and reliance on <em>reliable communication</em> for fault tolerance; <strong>Coda</strong> with <strong>ROWA</strong> (read one, write all) plus replication and caching, and a <em>reintegration</em> recovery; <strong>Plan 9</strong> with none; <strong>xFS</strong> with <strong>striping</strong> &mdash; a different use of multiple copies, spreading one file across servers for bandwidth rather than duplicating it; and <strong>SFS</strong> with none and <em>self-certifying</em> secure channels. The lesson to state: <strong>replication is a design choice with three different motivations &mdash; availability, read performance, and bandwidth &mdash; and consistency is the price of the first</strong>.</p>

<h2>4.2 NFS and HDFS</h2>

<h3>4.2.1 SUN NFS &mdash; what it is</h3>
<ul>
<li><strong>Developed by Sun Microsystems in 1985</strong>, and the <strong>first commercially successful network file system</strong>.</li>
<li>Developed for their <strong>diskless workstations</strong>, and <strong>designed for robustness and adequate performance</strong> &mdash; not for the best possible performance: <strong>Sun published all protocol specifications</strong>, which is why NFS became a standard rather than a product.</li>
<li>It runs on Sun OS, and it is <strong>both an implementation and a specification of how to access remote files</strong> &mdash; both a definition and a specific instance. The <strong>goal is to share a file system transparently</strong>.</li>
<li>It <strong>uses the client&ndash;server model, but a node can be both simultaneously and can act between any two nodes, so there is no dedicated server</strong>.</li>
</ul>
<!-- dcc-fig:ch4/chapter4-lecture-notes-all-s15-072.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch4/chapter4-lecture-notes-all-s15-072.webp" alt="SUN NFS Architecture" width="1066" height="666" loading="lazy" decoding="async">
<figcaption><strong>slide 15</strong> &middot; Chapter4_lecture_notes_all.pptx &mdash; SUN NFS Architecture</figcaption>
</figure>
<!-- /dcc-fig -->
<p>Two sentences in that list carry the whole design, and both are examinable. NFS is <em>both an implementation and a specification</em>: because Sun published the protocol rather than keeping it, other vendors could implement the same interface, which is how a product became the standard &mdash; and it is why 4.1.5 can describe a file service architecture and name NFS as its example without referring to any particular machine. And a node <em>can be both client and server and can act between any two nodes, so there is no dedicated server</em>: an NFS server is an ordinary machine exporting a directory, which makes the model symmetric in practice even though the protocol is not. The stated priority is robustness and adequate performance rather than the best possible performance, and 4.2.2 shows what that choice costs: a stateless service, and the recovery behaviour that follows from having no state to lose.</p>
<h3>4.2.2 Stateful versus stateless services</h3>
<p>NFS's single most consequential design decision is that it is <strong>stateless</strong>, and the deck sets up the choice before describing NFS so that the decision has a reason. This table is likely examinable on its own:</p>

<table class="comparison-table">
<thead>
<tr><th></th><th>Stateful service</th><th>Stateless service</th></tr>
</thead>
<tbody>
<tr><td><strong>Definition</strong></td><td>The server <strong>keeps track of information about client requests</strong>: which files are open by a client, connection identifiers, server caches.</td><td><strong>Each client request provides the complete information the server needs</strong> &mdash; filename, file offset, and so on. The server <em>may</em> keep information on behalf of the client, but it is not required to.</td></tr>
<tr><td><strong>Bookkeeping</strong></td><td>Memory must be reclaimed when a client closes a file or dies.</td><td>Nothing to reclaim; there is no per-client state to lose.</td></tr>
<tr><td><strong>Performance</strong></td><td><strong>Better</strong> &mdash; the filename does not have to be parsed on every request, and files do not have to be opened and closed again for each one.</td><td>Worse: every request repeats the lookup, which is why a stateless design has to be compensated with client caching.</td></tr>
<tr><td><strong>Fault tolerance</strong></td><td><strong>A stateful server loses everything when it crashes.</strong> Recovery requires the client and server to resynchronise their state.</td><td><strong>A stateless server remembers nothing, so it can start easily after a crash</strong> &mdash; the client simply retries.</td></tr>
</tbody>
</table>

<h3>4.2.3 NFS's design, and its three parts</h3>
<p>The deck lists NFS's characteristics, in the order it gives them: <strong>NFS is stateless</strong>; <strong>all client requests must be self-contained</strong>; <strong>machine and OS independence</strong>, so it could be implemented on the low-end machines of the mid-1980s; <strong>fast crash recovery</strong>, which is the major reason behind the stateless design; <strong>transparent access</strong>, so remote files are accessed exactly as local ones; and <strong>UNIX semantics maintained on the client</strong>.</p>

<p>The basic design has <strong>three important parts &mdash; the protocol, the server side and the client side</strong>:</p>

<table class="comparison-table">
<thead>
<tr><th>Part</th><th>Detail</th></tr>
</thead>
<tbody>
<tr><td><strong>The protocol</strong></td><td>Uses the <strong>Sun RPC mechanism</strong> and the <strong>Sun eXternal Data Representation (XDR)</strong> standard. It is <strong>defined as a set of remote procedures</strong> &mdash; so NFS is an application of exactly the RPC mechanism from Unit 2. <strong>The protocol is stateless: each procedure call contains all the information necessary to complete the call.</strong></td></tr>
<tr><td><strong>Server side</strong></td><td>The <strong>file handle</strong> consists of three things: a <strong>filesystem id identifying the disk partition</strong>, an <strong>i-node number identifying the file within the partition</strong>, and a <strong>generation number changed every time the i-node is reused to store a new file</strong>. The server stores the <strong>filesystem id in the file system superblock</strong> and the <strong>i-node generation number in the i-node</strong>. This is a naming scheme with exactly the shape 4.1.4 described: the handle is the file identifier that makes the mapping transparent.</td></tr>
<tr><td><strong>Client side</strong></td><td>Provides a <strong>transparent interface</strong> to NFS. The mapping between remote file names and remote file addresses is done <strong>at server boot time through remote mount</strong> &mdash; an <strong>extension of UNIX mounts</strong>, <strong>specified in a mount table</strong>, which <strong>makes a remote subtree appear part of a local subtree</strong>. A new <strong>virtual file system interface</strong> supports <strong>VFS calls, which operate on a whole file system, and VNODE calls, which operate on individual files</strong>, so all files are treated in the same fashion.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch4/chapter4-lecture-notes-all-s18-073.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch4/chapter4-lecture-notes-all-s18-073.webp" alt="Client side" width="846" height="461" loading="lazy" decoding="async">
<figcaption><strong>slide 18</strong> &middot; Chapter4_lecture_notes_all.pptx &mdash; Client side</figcaption>
</figure>
<!-- /dcc-fig -->
<p><strong>Access control and authentication.</strong> Because the NFS server is stateless, <strong>the user's identity and access rights must be checked by the server on every request</strong> &mdash; in a local file system they are checked once, against the file's access permission attribute. <strong>Every client request is accompanied by the userID and groupID, inserted by the RPC system</strong>, and <strong>Kerberos has been integrated with NFS</strong> to provide a stronger and more comprehensive security solution.</p>

<p><strong>Issues with NFS,</strong> as the deck lists them &mdash; a ready-made "criticise NFS" answer:</p>
<ul>
<li><strong>NFS root file systems cannot be shared</strong> ("too many problems").</li>
<li><strong>Clients can mount any remote subtree any way they want</strong>, so the same subtree can have <strong>different names on different clients</strong> by being mounted in different places &mdash; NFS uses a set of basic mounted file systems on each machine and lets users do the rest.</li>
<li><strong>NFS passes user id, group id and groups on each call</strong>, which <strong>requires the same mapping from user id and group id to user on all machines</strong> &mdash; a real constraint across administrative domains.</li>
<li><strong>NFS has no file locking.</strong></li>
<li><strong>In general NFS tries to preserve UNIX open file semantics but does not always succeed</strong>: if an opened file is removed by a process on another client, the file is <strong>immediately deleted</strong>.</li>
</ul>

<h3>4.2.4 HDFS &mdash; design and why it is shaped that way</h3>
<p><strong>When a dataset outgrows the storage capacity of a single physical machine, it becomes necessary to partition it across a number of separate machines. File systems that manage storage across a network of machines are called distributed file systems.</strong> Hadoop ships with one: <strong>HDFS, the Hadoop Distributed File System</strong>.</p>
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p05.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p05.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 5" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 5</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<p>HDFS is <strong>a file system designed for storing very large files with streaming data access patterns, running on clusters of commodity hardware</strong>. All three parts of that sentence matter:</p>
<ul>
<li><strong>Very large files</strong> &mdash; hundreds of megabytes, gigabytes or terabytes in size, with Hadoop clusters today holding petabytes.</li>
<li><strong>Streaming data access</strong> &mdash; HDFS is built around the idea that <strong>the most efficient data processing pattern is write-once, read-many-times</strong>: a dataset is generated or copied once, then analysed many times.</li>
<li><strong>Commodity hardware</strong> &mdash; Hadoop does not require expensive, highly reliable hardware; it is designed to run on commonly available hardware from multiple vendors, <strong>for which the chance of node failure across the cluster is high</strong>, at least for large clusters. <strong>HDFS is designed to carry on working without a noticeable interruption to the user in the face of such failure.</strong></li>
</ul>
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p04.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p04.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 4" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 4</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<p>And, exactly as with GFS, <strong>HDFS is not a good fit for</strong>: <strong>low-latency data access</strong> (applications needing responses in the tens of milliseconds will not work well), <strong>lots of small files</strong> (because the namenode holds filesystem metadata in memory, so the number of files is governed by the namenode's memory), and <strong>multiple writers or arbitrary file modifications</strong> (files may be written by a single writer, writes always at the end of the file, with no support for modifications at arbitrary offsets).</p>

<h3>4.2.5 Blocks</h3>
<p>HDFS has the concept of a <strong>block</strong>, but a much larger unit &mdash; <strong>64 MB by default</strong> (many installations use 128 MB). <strong>Files are broken into block-sized chunks, which are stored as independent units.</strong> Three benefits are given for the abstraction:</p>
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p38.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p38.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 38" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 38</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<ol>
<li><strong>A file can be larger than any single disk in the network.</strong> Nothing requires the blocks of a file to be on the same disk, so they can use any disk in the cluster.</li>
<li><strong>It simplifies the storage subsystem.</strong> The subsystem deals with blocks rather than files, which simplifies storage management (fixed size makes it easy to calculate how many fit on a disk) and <strong>eliminates metadata concerns</strong>.</li>
<li><strong>Blocks fit well with replication for fault tolerance and availability.</strong> To insure against corrupted blocks and disk and machine failure, <strong>each block is replicated to a small number of physically separate machines &mdash; typically three</strong>.</li>
</ol>

<div class="concept-box key">
<h4>Why the block is so large &mdash; the calculation to reproduce</h4>
<p><strong>To minimise the cost of seeks.</strong> By making a block large enough, the time to transfer the data from disk can be made significantly larger than the time to seek to the start of the block, so a large file made of multiple blocks transfers at the disk transfer rate. The number: <strong>if seek time is about 10 ms and the transfer rate is 100 MB/s, then to make the seek time 1% of the transfer time the block size must be about 100 MB.</strong> Hence the 64/128 MB defaults, and the note that the figure will keep being revised upward as transfer speeds grow.</p>
</div>
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p12.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p12.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 12" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 12</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>4.2.6 Namenodes and datanodes &mdash; the architecture</h3>
<figure class="figure-wide figure-wrap">
<svg class="figure wide" viewBox="0 0 780 340" role="img" aria-label="HDFS master-worker architecture: a client asks the NameNode for block locations, then reads or writes block data directly to DataNodes, which store blocks and report periodically to the NameNode">
<defs><marker id="f4b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="flow-arrow-head"/></marker></defs>

<rect class="flow-box phase1" x="30" y="120" width="150" height="46" rx="9"/>
<text class="flow-text" x="105" y="142">Client &mdash; needs</text>
<text class="flow-text" x="105" y="160">a file</text>

<rect class="flow-box phase2" x="315" y="30" width="230" height="60" rx="9"/>
<text class="flow-text" x="430" y="54">NameNode (master)</text>
<text class="flow-label" x="430" y="76" text-anchor="middle">namespace &middot; filesystem tree and metadata</text>

<rect class="flow-box phase3" x="270" y="140" width="180" height="46" rx="9"/>
<text class="flow-text" x="360" y="168">DataNode 1</text>
<rect class="flow-box phase3" x="480" y="140" width="180" height="46" rx="9"/>
<text class="flow-text" x="570" y="168">DataNode N</text>
<rect class="flow-box phase3" x="270" y="215" width="390" height="46" rx="9"/>
<text class="flow-text" x="465" y="243">Blocks stored as plain files on the local disk &mdash; replicated 3&times;</text>

<path class="flow-arrow" d="M182,132 L312,80" marker-end="url(#f4b)"/>
<text class="flow-label" x="228" y="92" text-anchor="middle">1. metadata request</text>
<path class="flow-arrow" d="M312,96 L182,150" marker-end="url(#f4b)"/>
<text class="flow-label" x="252" y="132" text-anchor="middle">2. block locations</text>
<path class="flow-arrow" d="M184,158 H266" marker-end="url(#f4b)"/>
<text class="flow-label" x="226" y="200" text-anchor="middle">3. read/write</text>
<text class="flow-label" x="226" y="220" text-anchor="middle">block data</text>
<path class="flow-arrow" d="M360,138 V92" marker-end="url(#f4b)"/>
<path class="flow-arrow" d="M570,138 V92" marker-end="url(#f4b)"/>
<text class="flow-label" x="640" y="118" text-anchor="middle">block reports</text>
<text class="flow-label" x="640" y="136" text-anchor="middle">(periodic)</text>

<text class="flow-label" x="390" y="300" text-anchor="middle">The NameNode knows <em>where</em> every block is; the data itself never passes through it.</text>
<text class="flow-label" x="390" y="322" text-anchor="middle">That is the design decision that lets one master serve a very large cluster.</text>
</svg>
<figcaption><strong>Fig 4.2 &mdash; HDFS in a master&ndash;worker pattern.</strong> The same separation appears in GFS, where the deck states it explicitly: <strong>data does not flow across the master</strong> &mdash; the client asks the master for the chunk handle and locations, caches the metadata, and then talks to a chunkserver directly for the bytes.</figcaption>
</figure>

<p>An HDFS cluster has <strong>two types of node operating in a master&ndash;worker pattern: a namenode (the master) and a number of datanodes (the workers)</strong>. The lecture's own description of the architecture is worth having in this vocabulary: the <strong>NameNode is the master of HDFS and directs the slave DataNode daemons to perform the low-level I/O tasks</strong>, and it <strong>keeps track of the file's splitting into blocks, its replication, and where those blocks are located</strong>. A <strong>Secondary NameNode takes snapshots of the NameNode</strong>, which is the checkpoint mechanism that keeps the namespace image and edit log from growing without bound &mdash; not a failover standby, which is the usual misreading of the name. The pages below are that architecture as the lecture draws it, including the daemon layout of a real cluster: one node running the name-node daemon, and every slave node running a datanode daemon over its own local Linux filesystem, reporting to the master.</p>
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p32.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p32.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 32" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 32</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p34.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p34.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 34" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 34</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<table class="comparison-table">
<thead>
<tr><th></th><th>NameNode (master)</th><th>DataNode (worker)</th></tr>
</thead>
<tbody>
<tr><td><strong>Role</strong></td><td>Manages the <strong>filesystem namespace</strong>: it maintains <strong>the filesystem tree and the metadata for all files and directories in the tree</strong>.</td><td>The <strong>workhorses of the filesystem</strong>: they <strong>store and retrieve blocks when told to</strong> (by clients or the namenode).</td></tr>
<tr><td><strong>Persistence</strong></td><td>Metadata is <strong>stored persistently on the local disk in the form of two files: the namespace image and the edit log</strong>.</td><td>Blocks are stored as <strong>independent units on local disk</strong>.</td></tr>
<tr><td><strong>What it knows</strong></td><td><strong>Which datanodes hold all the blocks for a given file</strong>; it determines the <strong>mapping of blocks to datanodes</strong> and regulates <strong>access to files by clients</strong>, including opening, closing and renaming files and directories.</td><td><strong>Report back to the namenode periodically with lists of blocks they are storing</strong>, and perform <strong>block creation, deletion and replication on the instruction of the namenode</strong>.</td></tr>
</tbody>
</table>

<p>The wider Hadoop design is the same shape: <strong>master: NameNode, JobTracker; slave: {DataNode, TaskTracker}</strong> repeated across the cluster, with HDFS being one primary component of the Hadoop cluster.</p>
<h3>4.2.7 Why the NameNode is a single point of failure, and the three remedies</h3>
<p><strong>If the machine running the namenode fails, all the files on the filesystem would be lost, because there would be no way of knowing how to reconstruct the files from the blocks on the datanodes.</strong> That is the fault the whole of HDFS's recovery design is aimed at, and the exam's "how does HDFS ensure fault tolerance" half wants these mechanisms named:</p>

<table class="comparison-table">
<thead>
<tr><th>Mechanism</th><th>How it works</th></tr>
</thead>
<tbody>
<tr><td><strong>1. Backing up the persistent metadata state</strong></td><td>Hadoop can be configured so that the namenode <strong>writes its persistent state to multiple filesystems</strong>. These writes are <strong>synchronous and atomic</strong>. The usual configuration is to write to <strong>local disk as well as a remote NFS mount</strong>.</td></tr>
<tr><td><strong>2. The secondary namenode</strong></td><td>Despite its name it <strong>does not act as a namenode</strong>. Its main role is to <strong>periodically merge the namespace image with the edit log to prevent the edit log from becoming too large</strong> &mdash; but it <strong>can be shaped to act as the primary namenode</strong>. Note the two distinct purposes: checkpointing in normal operation, and a fallback if the primary is lost.</td></tr>
<tr><td><strong>3. HDFS Federation (0.23 series)</strong></td><td>A <strong>scalability</strong> mechanism rather than a recovery one: because the namenode keeps a reference to every file and block <strong>in memory</strong>, memory becomes the limiting factor on very large clusters. Federation <strong>allows a cluster to scale by adding namenodes, each managing a portion of the filesystem namespace</strong> &mdash; one might manage everything under <code>/user</code>, another everything under <code>/share</code>. <strong>Namespace volumes are independent, namenodes do not communicate, and the failure of one does not affect the availability of the others</strong> &mdash; but <strong>block pool storage is not partitioned</strong>, so datanodes register with every namenode and store blocks from multiple block pools.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p23.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p23.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 23" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 23</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p24.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p24.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 24" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 24</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch4/hdfs-note-4std-lecture-p04.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch4/hdfs-note-4std-lecture-p04.webp" alt="Second way:" width="1241" height="1754" loading="lazy" decoding="async">
<figcaption><strong>page 4</strong> &middot; HDFS_Note_4Std_lecture.pdf &mdash; Second way:</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>4.2.8 HDFS high availability, failover and fencing</h3>
<p><strong>The namenode is still a single point of failure (SPOF)</strong>: if it fails, <strong>all clients &mdash; including MapReduce jobs &mdash; would be unable to read, write or list files</strong>, because it is the sole repository of the metadata and the file-to-block mapping. <strong>The whole Hadoop system would effectively be out of service until a new namenode could be brought online.</strong></p>

<p>Recovering the old way means an administrator starts a new primary namenode from one of the metadata replicas and reconfigures datanodes and clients to use it. <strong>The new namenode cannot serve requests until it has (i) loaded its namespace image into memory, (ii) replayed its edit log, and (iii) received enough block reports from the datanodes to leave safe mode.</strong> On large clusters <strong>a cold start can take 30 minutes or more</strong> &mdash; which is precisely the argument for doing better.</p>

<p><strong>HDFS high availability</strong> (0.23 series) does better by running <strong>a pair of namenodes in an active&ndash;standby configuration</strong>, where <strong>on failure of the active namenode the standby takes over its duties and continues servicing client requests without significant interruption</strong>. Three architectural changes are needed:</p>
<ul>
<li>The namenodes must <strong>use highly available shared storage to share the edit log</strong>.</li>
<li><strong>Datanodes must send block reports to both namenodes</strong>, because the block mappings are stored <strong>in a namenode's memory and not on disk</strong>.</li>
<li><strong>Clients must be configured to handle namenode failover</strong>, using a mechanism that is <strong>transparent to users</strong>.</li>
</ul>
<p>The transition is managed by a <strong>failover controller</strong>; controllers are <strong>pluggable</strong>, and <strong>the first implementation uses ZooKeeper to ensure only one namenode is active</strong>. Failover may also be <strong>initiated manually by an administrator</strong>, for routine maintenance &mdash; a <strong>graceful failover</strong>, in which the controller arranges an orderly role switch for both namenodes. In an <strong>ungraceful failover</strong>, the implementation goes to great lengths to ensure the previously active namenode <strong>cannot do any damage or cause corruption &mdash; a method known as fencing</strong>.</p>

<h3>4.2.9 GFS, and how HDFS relates to it</h3>
<p><strong>HDFS was inspired by GFS</strong> (the Google File System), and the GFS lecture supplies the assumptions and the read path that explain HDFS's shape. Both are <strong>one way &mdash; not the only way &mdash; to design a distributed file system</strong>, and Hadoop is heavily inspired by GFS.</p>
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p02.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p02.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 2" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 2</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p03.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p03.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 3" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 3</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p28.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p28.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 28" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 28</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<p><strong>GFS's design is based on Google's main use cases</strong>, and every assumption reappears as an HDFS property:</p>
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p29.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p29.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 29" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 29</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p31.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p31.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 31" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 31</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<ul>
<li><strong>Hardware failures are common</strong> (commodity hardware).</li>
<li><strong>Files are large (GB/TB) and their number is limited</strong> (millions, not billions).</li>
<li><strong>Two main types of reads: large streaming reads and small random reads.</strong></li>
<li><strong>Workloads with sequential writes that append data to files</strong> &mdash; which is exactly HDFS's "write-once, read-many, writes always at the end".</li>
<li><strong>Once written, files are seldom modified again</strong> (other than appending); random modification is possible but not efficient in GFS.</li>
<li><strong>High sustained bandwidth trumps low latency</strong> &mdash; the design goal that makes HDFS unsuitable for the tens-of-milliseconds range.</li>
</ul>
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p06.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p06.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 6" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 6</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p07.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p07.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 7" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 7</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p14.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p14.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 14" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 14</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<p>The GFS architecture is <strong>a single master holding metadata plus many chunkservers holding chunks, with several clients</strong>. Files are divided into <strong>fixed-size chunks (64 MB) with unique 64-bit identifiers assigned by the master at chunk creation time</strong>, and <strong>chunkservers store chunks on local disk as normal Linux files</strong>; reading and writing is specified by the tuple <strong>(chunk handle, byte range)</strong>. The master maintains <strong>all file system metadata</strong> &mdash; <strong>namespace, access control information, the mapping from files to chunks and the locations of chunk replicas</strong> &mdash; and <strong>files are replicated by default three times across chunkservers</strong>. <strong>Heartbeat messages</strong> between master and chunkservers answer two questions: <strong>is the chunkserver still alive, and what chunks does it store?</strong></p>
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p08.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p08.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 8" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 8</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p10.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p10.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 10" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 10</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p11.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p11.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 11" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 11</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<p>The read path, in the lecture's five steps, is the clearest statement of the master/worker split:</p>
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p22.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p22.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 22" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 22</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p25.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p25.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 25" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 25</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p27.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p27.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 27" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 27</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<ol>
<li><strong>The client translates the filename and byte offset specified by the application into a chunk index within the file, and sends the request to the master.</strong></li>
<li><strong>The master replies with the chunk handle and the locations</strong> of the replicas.</li>
<li><strong>The client caches the metadata.</strong></li>
<li><strong>The client sends a data request to one of the replicas &mdash; the closest one.</strong> The byte range indicates the wanted part of the chunk, and more than one chunk can be included in a single request.</li>
<li><strong>The contacted chunkserver replies with the requested data.</strong></li>
</ol>
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p15.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p15.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 15" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 15</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p16.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p16.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 16" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 16</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p17.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p17.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 17" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 17</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<p>Metadata is of <strong>three types</strong> &mdash; <strong>files and chunk namespaces, the mapping from files to chunks, and the locations of each chunk's replicas</strong> &mdash; and <strong>all of it is kept in the master's memory</strong> for fast random access, which <strong>sets limits on the entire system's capacity</strong> (compare HDFS federation). An <strong>operation log is kept on the master's local disk</strong> so that the master's state can be recovered after a crash: <strong>namespaces and mappings are logged, but chunk locations are not</strong> &mdash; the master asks the chunkservers instead, which is why <strong>the chunkserver has the final word over what chunks it has</strong>.</p>
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p18.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p18.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 18" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 18</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p19.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p19.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 19" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 19</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p21.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p21.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 21" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 21</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<h2>4.3 Middleware</h2>

<h3>4.3.1 Heterogeneity, and why middleware exists</h3>
<p><strong>Distributed applications are typically heterogeneous</strong>, and the deck lists the four dimensions:</p>
<ul>
<li><strong>Different hardware</strong> &mdash; mainframes, workstations, PCs, servers.</li>
<li><strong>Different software</strong> &mdash; UNIX, MS Windows, IBM OS/2, real-time operating systems.</li>
<li><strong>Unconventional devices</strong> &mdash; teller machines, telephone switches, robots, manufacturing systems.</li>
<li><strong>Diverse networks and protocols</strong> &mdash; Ethernet, FDDI, ATM, TCP/IP, Novell NetWare.</li>
</ul>
<p>And <em>why</em> it is heterogeneous: <strong>different hardware and software solutions are considered optimal for different parts of the system</strong>; <strong>different users who have to interact decide on different hardware, software and vendors</strong>; and <strong>legacy systems</strong> must be kept working.</p>

<div class="concept-box key">
<h4>The definition to quote</h4>
<p><strong>A key component of a heterogeneous distributed client&ndash;server environment is middleware: a set of services that enable applications and end users to interact with each other across a heterogeneous distributed system. Middleware software resides above the network and below the application software.</strong> The two jobs it must do are <strong>to make the network transparent to applications and end users</strong> &mdash; so users and applications can perform the same operations across the network that they can perform locally &mdash; and <strong>to hide the details of computing hardware, operating system and software components across networks</strong>. The deck notes that a range of software qualifies to a certain extent: <strong>file-transfer packages (FTP) and email, web browsers, and CORBA</strong>.</p>
</div>
<!-- dcc-fig:ch4/chapter4-lecture-notes-all-s23-074.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch4/chapter4-lecture-notes-all-s23-074.webp" alt="Middleware" width="366" height="239" loading="lazy" decoding="async">
<figcaption><strong>slide 23</strong> &middot; Chapter4_lecture_notes_all.pptx &mdash; Middleware</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>4.3.2 CORBA</h3>
<p>The <strong>Object Management Group (OMG)</strong> is a <strong>non-profit industry consortium formed in 1989</strong> with the goal of developing, adopting and promoting <strong>standards for distributed heterogeneous applications</strong>. One of its main achievements is the specification of the <strong>Common Object Request Broker Architecture (CORBA)</strong>, which <strong>details the interfaces and characteristics of the Object Request Broker</strong> &mdash; practically specifying <strong>the middleware functions that allow application objects to communicate no matter where they are located, who designed them, and in which language they are implemented</strong>.</p>

<div class="concept-box warn">
<h4>The one distinction that gets asked</h4>
<p><strong>OMG only provides a specification.</strong> There are several products which, to a certain extent, implement the specification. So CORBA is a standard, not a piece of software &mdash; and "CORBA is a language" or "CORBA is a product" are both wrong. It is <em>language-neutral and vendor-neutral middleware defined by an IDL</em>.</p>
</div>

<h4>The object model CORBA specifies</h4>
<p><strong>Key concepts.</strong> CORBA specifies the middleware services used by application objects; <strong>an object can be a client, a server, or both</strong>; and <strong>object interaction is through requests</strong>, where the information associated with a request is <strong>an operation to be performed, a target object, and zero or more parameters</strong>. CORBA <strong>supports both static and dynamic binding</strong>, where dynamic binding uses runtime identification of objects and parameters. <strong>The interface represents the contract between client and server</strong>; an <strong>IDL has been defined for CORBA</strong>, and <strong>proxies and skeletons (the client and server stubs) are generated as a result of IDL compilation</strong>. Finally, <strong>CORBA objects do not know the underlying implementation details &mdash; an object adapter maps the generic model to a specific implementation</strong>.</p>
<h4>The two repositories: what makes dynamic invocation possible</h4>
<table class="comparison-table">
<thead>
<tr><th>Repository</th><th>What it holds</th><th>Why it matters</th></tr>
</thead>
<tbody>
<tr><td><strong>Interface repository</strong></td><td>A standard representation of <strong>available object interfaces for all objects in the distributed environment</strong>, corresponding to the server objects' <strong>IDL specification</strong>. For an interface of a given type it supplies <strong>the names of the methods and, for each method, the names and types of the arguments and exceptions</strong>.</td><td>Clients access it <strong>to learn about server objects and determine which operations can be invoked and with which parameters</strong> &mdash; this is what makes <strong>dynamic invocation</strong> possible, and the deck calls it <strong>a facility for reflection in CORBA</strong>. The IDL compiler gives each type a <strong>type identifier</strong> which is included in remote object references as the <strong>repository ID</strong>. Applications using <strong>static invocation with proxies and IDL skeletons do not require an interface repository</strong>, and <strong>not all ORBs provide one</strong>.</td></tr>
<tr><td><strong>Implementation repository</strong></td><td><strong>Implementation details for the objects implementing each interface</strong>: mainly <strong>a mapping from the server object's name to the file name implementing the service</strong>, plus information about object methods and what is needed for method selection. It <strong>activates registered servers on demand and locates running servers</strong>, uses the <strong>object adapter name</strong> to register and activate servers, and stores <strong>a mapping from object adapter names to pathnames of files containing object implementations</strong>. When an object implementation is activated, the <strong>hostname and port number of the server are added to the mapping</strong>. An entry is: <strong>object adapter name | pathname of object implementation | hostname and port number</strong>. Information in it <strong>can be operating-system specific and can differ between CORBA implementations</strong>, and <strong>access control information can be stored in it</strong>.</td><td>The <strong>object adapter uses it to resolve an incoming call and activate the right object method via a server skeleton</strong>. Note that <strong>not all CORBA objects (callbacks, for example) need be activated on demand</strong>.</td></tr>
</tbody>
</table>

<h4>Remote object references: IORs</h4>
<p><strong>Remote object references.</strong> CORBA 2.0 introduced <strong>Interoperable Object References (IORs)</strong>, which are suitable whether or not the object is activatable. <strong>Transient IORs</strong> are for objects that last as long as the host process and contain the address of the server hosting the CORBA object: the server ORB core receives the request containing the <strong>object adapter name and object name</strong> of the target, uses the adapter name to locate the object adapter, which uses the object name to locate the servant. <strong>Persistent IORs</strong> last between activations and contain the address of the <strong>implementation repository</strong>: the repository receives the request, activates the object, then gives the server address to the client, and <strong>the client sends subsequent invocations to the server</strong>. The IOR format is <strong>IDL interface type name | protocol and address details | object key</strong>, where the address details are <strong>IIOP, host domain name and port number</strong>, and the object key holds the <strong>interface repository identifier, adapter name and object name</strong>.</p>

<h4>The ORB, and how two ORBs talk to each other</h4>
<p><strong>Inter-ORB architecture.</strong> Because ORB implementations differ from vendor to vendor, interaction between objects on different CORBA implementations needs a common protocol:</p>
<ul>
<li><strong>GIOP (General Inter-ORB Protocol)</strong> is defined in CORBA 2.0 and <strong>specifies a set of message formats and common data representations for interactions between ORBs</strong>, intended <strong>to operate over any connection-oriented transport protocol</strong>.</li>
<li><strong>IIOP (Internet Inter-ORB Protocol)</strong> is <strong>a particularisation of GIOP</strong>: it specifies <strong>how GIOP messages have to be exchanged over a TCP/IP network</strong>.</li>
</ul>
<!-- dcc-fig:ch4/chapter4-lecture-notes-all-s35-078.webp -->
<figure class="figure-wrap teacher-i" title="The teacher's deck marks this slide with a circled i &mdash; the sign he puts on pages he is not going to examine. The section is kept because the syllabus still names what it teaches.">
<img class="figure wide slide" src="assets/dcc-slides/ch4/chapter4-lecture-notes-all-s35-078.webp" alt="Inter-ORB Architecture" width="386" height="149" loading="lazy" decoding="async">
<figcaption><strong>slide 35</strong> &middot; Chapter4_lecture_notes_all.pptx &mdash; Inter-ORB Architecture <span class="tmark-chip"><span class="tmark" aria-hidden="true"></span><span class="tmark-text">teacher marks this slide</span></span></figcaption>
</figure>
<!-- /dcc-fig -->
<p><strong>The Object Request Broker (ORB)</strong> is the core: through its interfaces it <strong>provides mechanisms by which objects transparently interact with each other</strong>. Issuing a request can be <strong>dynamic or static</strong>, performed through the <strong>proxies (client stubs) or the dynamic invocation interface</strong>; <strong>invocation of a specific server method is performed by the server skeleton</strong>, which gets the request forwarded from the object adapter; and <strong>the ORB interface can also be accessed directly by clients and object implementations for certain services</strong> &mdash; directory services, naming services, and manipulation of object references. Some of its interfaces are <strong>identical for all ORB implementations</strong> and some are <strong>implementation dependent</strong>.</p>
<!-- dcc-fig:ch4/chapter4-lecture-notes-all-s33-077.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch4/chapter4-lecture-notes-all-s33-077.webp" alt="The Object Request Broker (ORB)" width="360" height="314" loading="lazy" decoding="async">
<figcaption><strong>slide 33</strong> &middot; Chapter4_lecture_notes_all.pptx &mdash; The Object Request Broker (ORB)</figcaption>
</figure>
<!-- /dcc-fig -->
<h4>Static versus dynamic invocation</h4>

<table class="comparison-table">
<thead>
<tr><th></th><th>Static invocation</th><th>Dynamic invocation</th></tr>
</thead>
<tbody>
<tr><td><strong>What it is based on</strong></td><td><strong>Compile-time knowledge of the server's interface specification</strong>, formulated in IDL and compiled into a <strong>proxy (client stub)</strong> in the client's programming language.</td><td>Allows a client to <strong>invoke requests on an object without compile-time knowledge of its interface</strong>; the object and its interface (methods, parameters, types) are <strong>detected at run time</strong>.</td></tr>
<tr><td><strong>Mechanism</strong></td><td>For the client an object invocation <strong>looks like a local invocation to a proxy method</strong>; the invocation is then automatically forwarded to the object implementation through the <strong>ORB, the object adapter and the skeleton</strong>.</td><td>CORBA provides, through the <strong>dynamic invocation interface</strong>, mechanisms <strong>to inspect the interface repository, construct invocations dynamically, and supply argument values</strong> matching the server's interface specification.</td></tr>
<tr><td><strong>Cost and effect</strong></td><td><strong>Efficient at run time because of the relatively low overhead.</strong></td><td><strong>The execution overhead of a dynamic invocation is huge</strong> &mdash; the interface is discovered and the request built at runtime.</td></tr>
<tr><td><strong>The server's view</strong></td><td colspan="2"><strong>Identical.</strong> <strong>From the server's point of view static and dynamic invocation are the same; the server does not know how it has been invoked, because server invocation is always issued through its skeleton, generated at compile time from the IDL specification.</strong></td></tr>
</tbody>
</table>
<!-- dcc-fig:ch4/chapter4-lecture-notes-all-s27-075.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch4/chapter4-lecture-notes-all-s27-075.webp" alt="CORBA…" width="383" height="220" loading="lazy" decoding="async">
<figcaption><strong>slide 27</strong> &middot; Chapter4_lecture_notes_all.pptx &mdash; CORBA…</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch4/chapter4-lecture-notes-all-s28-076.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch4/chapter4-lecture-notes-all-s28-076.webp" alt="Main components of CORBA Architecture" width="1066" height="331" loading="lazy" decoding="async">
<figcaption><strong>slide 28</strong> &middot; Chapter4_lecture_notes_all.pptx &mdash; Main components of CORBA Architecture</figcaption>
</figure>
<!-- /dcc-fig -->
<h4>The object adapter</h4>
<p><strong>The Object Adapter (OA)</strong> is <strong>the primary interface between the server object implementation and the ORB</strong>, and it <strong>bridges the gap between CORBA objects with IDL interfaces and the programming language interfaces of the corresponding servant classes</strong>. It <strong>does the work of the remote reference and dispatcher modules</strong> from Unit 2. Its tasks: it <strong>creates remote object references for CORBA objects</strong>; it <strong>dispatches each remote invocation via a skeleton to the appropriate servant</strong>; and it <strong>activates objects</strong>. It <strong>gives each CORBA object a unique object name</strong>, the same name being used each time the object is activated, and <strong>keeps a remote object table mapping names of CORBA objects to servants</strong>; each adapter has its own name, specified by the application or generated automatically. The services a <strong>Basic Object Adapter</strong> provides are <strong>object registration</strong> (entities written in a given language are registered as CORBA objects), <strong>object reference generation</strong>, <strong>object upcalls</strong> (dispatching incoming requests to registered objects) and <strong>server process and object activation</strong>.</p>

<h4>CORBA services</h4>
<p><strong>CORBA services</strong> &mdash; the deck lists them and notes that <strong>current products implement only some of them</strong>:</p>
<table class="comparison-table">
<thead>
<tr><th>Service</th><th>What it provides</th></tr>
</thead>
<tbody>
<tr><td><strong>Naming and Trading</strong></td><td>The basic way an object reference is generated is at creation of the object, when the reference is returned; references can be stored with associated information such as names and properties. <strong>The naming service allows clients to find objects based on names</strong>; <strong>the trading service allows clients to find objects based on their properties</strong>, locating CORBA objects by attribute.</td></tr>
<tr><td><strong>Security</strong></td><td>Protects components from unauthorized users: <strong>authentication, access control lists, confidentiality</strong>; authentication of principals and <strong>access control of CORBA objects with policies</strong>; <strong>auditing by servers and facilities for non-repudiation</strong>.</td></tr>
<tr><td><strong>Time</strong></td><td>Interfaces for <strong>synchronizing time</strong> and operations for <strong>defining and managing time-triggered events</strong> &mdash; the Unit 3 problem, offered as middleware.</td></tr>
<tr><td><strong>Event and Notification</strong></td><td>In the event service, <strong>suppliers and consumers communicate via an event channel</strong>; the notification service <strong>extends this to allow filtering and typed events</strong>.</td></tr>
<tr><td><strong>Transaction and Concurrency Control</strong></td><td>The transaction service provides <strong>flat or nested transactions</strong> and <strong>two-phase-commit coordination among recoverable components</strong>; the concurrency control service provides <strong>locking of CORBA objects</strong> and a <strong>lock manager that can obtain and free locks for transactions or threads</strong>.</td></tr>
<tr><td><strong>Persistent Object</strong></td><td>For <strong>storing the state of CORBA objects in a passive form and retrieving it</strong>.</td></tr>
</tbody>
</table>

<h3>4.3.3 Java RMI as middleware</h3>
<p>The syllabus names Java RMI alongside CORBA as middleware, and the comparison is the point: <strong>CORBA is language-neutral middleware defined by an IDL, while Java RMI is a language-specific middleware built into one language.</strong> RMI <strong>extends the Java object model to provide support for distributed objects</strong>, lets objects invoke methods on remote objects <strong>using the same syntax as for local invocations</strong>, applies type checking equally to remote and local calls, and provides a <strong>binder</strong> mapping textual names to remote object references. Its cost is that it is a <strong>single-language system</strong>. The mechanism &mdash; <strong>proxy, dispatcher, skeleton, remote reference module and binder, with the at-most-once invocation semantics</strong> &mdash; is covered in full in <strong>Unit 2.2</strong>.</p>

<p>Place RMI in the middleware list honestly: it is <em>language-specific</em> middleware, which sounds like a contradiction until you remember what middleware is for. It supplies the same thing CORBA does &mdash; a programming abstraction over the network, so that one object can call another wherever it runs (Unit 1.3's answer to heterogeneity) &mdash; but only inside a Java system. In a heterogeneous estate that is not enough, and CORBA's IDL exists precisely to remove that limit; inside a homogeneous Java system it is worth a great deal, because the abstraction costs a programmer nothing to adopt and the type checking is the language's own. The sentence to write in an answer is the one-line rule: <strong>CORBA's interface is defined in a neutral language, Java RMI's is the language itself</strong>. Everything else &mdash; the binder, the proxy and the skeleton, at-most-once semantics &mdash; is the same machinery under two names.</p>

<h3>4.3.4 Messaging middleware: MQTT and AMQP</h3>
<p>The third family in the syllabus is message-oriented middleware. The deck introduces it as a comparison of four protocols &mdash; <strong>CoAP, MQTT, AMQP and XMPP</strong> &mdash; and then treats two of them in detail.</p>

<p><strong>MQTT (Message Queuing Telemetry Transport)</strong> is <strong>a messaging protocol designed for publish&ndash;subscribe messaging between lightweight devices</strong>. It is <strong>designed for unreliable networks or intermittent connectivity</strong>, for <strong>exchanging data with the cloud</strong>, and it is <strong>very popular and widespread for IoT and M2M applications</strong> where it has become a standard. On the stack it sits <strong>over TCP</strong> &mdash; and a variant, <strong>MQTT-SN (Sensor Networks), can use other transport protocols such as UDP or Bluetooth</strong>.</p>
<!-- dcc-fig:ch4/ch4-messagingprotocol-mqtt-amqp-for-students-p01.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch4/ch4-messagingprotocol-mqtt-amqp-for-students-p01.webp" alt="Diagram from Ch4_MessagingProtocol_MQTT_AMQP_For_Students.pdf, page 1" width="1600" height="2262" loading="lazy" decoding="async">
<figcaption><strong>page 1</strong> &middot; Ch4_MessagingProtocol_MQTT_AMQP_For_Students.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch4/ch4-messagingprotocol-mqtt-amqp-for-students-p02.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch4/ch4-messagingprotocol-mqtt-amqp-for-students-p02.webp" alt="Diagram from Ch4_MessagingProtocol_MQTT_AMQP_For_Students.pdf, page 2" width="1600" height="2262" loading="lazy" decoding="async">
<figcaption><strong>page 2</strong> &middot; Ch4_MessagingProtocol_MQTT_AMQP_For_Students.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<figure class="figure-wide figure-wrap">
<svg class="figure wide" viewBox="0 0 780 300" role="img" aria-label="MQTT publish-subscribe model: publishers send messages to a broker, which forwards them to subscribers that have registered interest in a topic; the broker decouples publisher from subscriber">
<defs><marker id="f4c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="flow-arrow-head"/></marker></defs>

<rect class="flow-box phase1" x="40" y="40" width="170" height="46" rx="9"/>
<text class="flow-text" x="125" y="68">Publisher (client B)</text>
<rect class="flow-box phase1" x="40" y="190" width="170" height="46" rx="9"/>
<text class="flow-text" x="125" y="218">Publisher</text>

<rect class="flow-box phase2" x="305" y="100" width="170" height="76" rx="9"/>
<text class="flow-text" x="390" y="128">Broker</text>
<text class="flow-label" x="390" y="150" text-anchor="middle">receives data from publishers,</text>
<text class="flow-label" x="390" y="166" text-anchor="middle">forwards it to interested subscribers</text>

<rect class="flow-box phase3" x="570" y="40" width="170" height="46" rx="9"/>
<text class="flow-text" x="655" y="68">Subscriber (client A)</text>
<rect class="flow-box phase3" x="570" y="190" width="170" height="46" rx="9"/>
<text class="flow-text" x="655" y="218">Subscriber</text>

<path class="flow-arrow" d="M214,72 L301,110" marker-end="url(#f4c)"/>
<text class="flow-label" x="248" y="86" text-anchor="middle">PUBLISH</text>
<text class="flow-label" x="248" y="104" text-anchor="middle">&quot;/temp&quot;</text>
<path class="flow-arrow" d="M214,208 L301,168" marker-end="url(#f4c)"/>
<text class="flow-label" x="248" y="204" text-anchor="middle">PUBLISH</text>

<path class="flow-arrow" d="M479,110 L566,72" marker-end="url(#f4c)"/>
<text class="flow-label" x="520" y="86" text-anchor="middle">deliver</text>
<path class="flow-arrow" d="M479,168 L566,208" marker-end="url(#f4c)"/>
<text class="flow-label" x="520" y="204" text-anchor="middle">deliver</text>
<path class="flow-arrow" d="M566,196 H483" stroke-dasharray="4 3"/>
<text class="flow-label" x="524" y="240" text-anchor="middle">SUBSCRIBE &quot;/temp&quot;</text>

<text class="flow-label" x="390" y="278" text-anchor="middle">The publisher never names a receiver, and the subscriber never names a sender &mdash; the broker and the topic decouple them.</text>
</svg>
<figcaption><strong>Fig 4.3 &mdash; The MQTT model.</strong> <strong>Broker:</strong> a server that receives the data from publishers and forwards it to the interested subscribers. <strong>Publisher:</strong> a client that sends data to the broker. <strong>Subscriber:</strong> a client registered on the broker to receive updates from specific sources. The deck's example interaction is <strong>CONNECT/CONNACK, SUBSCRIBE &quot;/temp&quot;/SUBACK, PUBLISH &quot;item&quot;/PUBACK</strong> between broker, subscriber (client A) and publisher (client B).</figcaption>
</figure>
<!-- dcc-fig:ch4/ch4-messagingprotocol-mqtt-amqp-for-students-p03.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch4/ch4-messagingprotocol-mqtt-amqp-for-students-p03.webp" alt="Diagram from Ch4_MessagingProtocol_MQTT_AMQP_For_Students.pdf, page 3" width="1600" height="2262" loading="lazy" decoding="async">
<figcaption><strong>page 3</strong> &middot; Ch4_MessagingProtocol_MQTT_AMQP_For_Students.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch4/ch4-messagingprotocol-mqtt-amqp-for-students-p04.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch4/ch4-messagingprotocol-mqtt-amqp-for-students-p04.webp" alt="Diagram from Ch4_MessagingProtocol_MQTT_AMQP_For_Students.pdf, page 4" width="1600" height="2262" loading="lazy" decoding="async">
<figcaption><strong>page 4</strong> &middot; Ch4_MessagingProtocol_MQTT_AMQP_For_Students.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<p><strong>The MQTT message format</strong> is worth a line because it is what "lightweight" means concretely: a <strong>1-byte control header</strong> and a <strong>1-to-4-byte packet length</strong> form a <strong>fixed header that is always present</strong>, followed by a <strong>variable-length header</strong> whose size depends on the message type and which is not always present, and then <strong>0&ndash;Y bytes of payload</strong> &mdash; the actual data to send. <strong>The payload may not be present</strong>, for example in CONNACK.</p>
<!-- dcc-fig:ch4/ch4-messagingprotocol-mqtt-amqp-for-students-p05.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch4/ch4-messagingprotocol-mqtt-amqp-for-students-p05.webp" alt="Diagram from Ch4_MessagingProtocol_MQTT_AMQP_For_Students.pdf, page 5" width="1600" height="2262" loading="lazy" decoding="async">
<figcaption><strong>page 5</strong> &middot; Ch4_MessagingProtocol_MQTT_AMQP_For_Students.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<p><strong>AMQP (Advanced Message Queuing Protocol)</strong> is <strong>a lightweight but binary application-layer messaging protocol designed for M2M messaging</strong>. It is <strong>generally used in corporate environments</strong>, <strong>focuses on interoperability</strong>, and supports <strong>both the publish&ndash;subscribe and request&ndash;response models</strong>. Its architecture is built on a <strong>broker and multiple queues</strong> &mdash; the deck's diagram shows one broker fronting several numbered queues.</p>
<!-- dcc-fig:ch4/ch4-messagingprotocol-mqtt-amqp-for-students-p06.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch4/ch4-messagingprotocol-mqtt-amqp-for-students-p06.webp" alt="Diagram from Ch4_MessagingProtocol_MQTT_AMQP_For_Students.pdf, page 6" width="1600" height="2262" loading="lazy" decoding="async">
<figcaption><strong>page 6</strong> &middot; Ch4_MessagingProtocol_MQTT_AMQP_For_Students.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch4/ch4-messagingprotocol-mqtt-amqp-for-students-p07.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch4/ch4-messagingprotocol-mqtt-amqp-for-students-p07.webp" alt="Diagram from Ch4_MessagingProtocol_MQTT_AMQP_For_Students.pdf, page 7" width="1600" height="2262" loading="lazy" decoding="async">
<figcaption><strong>page 7</strong> &middot; Ch4_MessagingProtocol_MQTT_AMQP_For_Students.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<table class="comparison-table">
<thead>
<tr><th></th><th>MQTT</th><th>AMQP</th></tr>
</thead>
<tbody>
<tr><td><strong>Model</strong></td><td><strong>Publish&ndash;subscribe</strong> through a broker, with topics.</td><td>Supports <strong>both publish&ndash;subscribe and request&ndash;response</strong>, with queues and exchanges.</td></tr>
<tr><td><strong>Encoding</strong></td><td>Compact binary framing: 1-byte control header, 1&ndash;4-byte length, optional variable header and payload.</td><td><strong>Binary application-layer</strong> protocol &mdash; more featureful, hence the "lightweight but" framing in the deck.</td></tr>
<tr><td><strong>Designed for</strong></td><td><strong>Unreliable networks or intermittent connectivity</strong>; lightweight devices; IoT and M2M.</td><td><strong>M2M messaging</strong> in general, with <strong>interoperability</strong> as the focus; generally <strong>corporate environments</strong>.</td></tr>
<tr><td><strong>Transport</strong></td><td><strong>Over TCP</strong>; MQTT-SN can use UDP or Bluetooth.</td><td>Application layer, typically over TCP.</td></tr>
<tr><td><strong>Both are listed with</strong></td><td colspan="2"><strong>CoAP</strong> and <strong>XMPP</strong> as the other two protocols compared in the deck &mdash; CoAP for constrained devices, XMPP an older XML-based messaging standard.</td></tr>
</tbody>
</table>

<div class="concept-box tip">
<h4>How to place the three middleware families in one answer</h4>
<p><strong>CORBA</strong> is the object-oriented, language-neutral, IDL-defined family &mdash; remote method invocation between heterogeneous objects through an ORB. <strong>Java RMI</strong> is the same idea inside one language, with the binder playing the role of the naming service. <strong>MQTT and AMQP</strong> are message-oriented, and they differ from both in that the sender and receiver are <em>decoupled</em>: the sender publishes to a broker or an exchange and never names a receiver, which is what makes them suit intermittent connectivity and large numbers of devices. All three exist for the same reason middleware exists at all &mdash; heterogeneity &mdash; and all three sit <strong>above the network and below the application</strong>.</p>
</div>

<div class="concept-box tip">
<h4>The paper-facing part of this unit</h4>
<p>Everything in this unit that is written to be answered in the exam &mdash; what each question asks for, and the model answer to it &mdash; is collected in <a href="#/ch/4/past">Past Questions</a>. Read this tab for the subject; switch to that one when you sit down to answer a question.</p>
</div>
`,

  pastSummary: `<h2>Exam-facing summary</h2>
<table class="comparison-table">
<thead>
<tr><th>If the question says&hellip;</th><th>Give&hellip;</th></tr>
</thead>
<tbody>
<tr><td>Define a distributed file system</td><td>A classical model of a file system distributed across multiple machines, promoting the sharing of dispersed files; resources on a machine are local, resources elsewhere are remote; programs access remote files exactly as local ones; performance measured by throughput and response time.</td></tr>
<tr><td>DFS design goals / requirements</td><td>Transparency, concurrency, replication, heterogeneity, fault tolerance, consistency, security, efficiency &mdash; one line each.</td></tr>
<tr><td>Explain the file service architecture</td><td>Flat file service (operations on contents, addressed by UFID), directory service (text name &rarr; UFID), client module (single API, server locations, block cache) &mdash; Fig 4.1.</td></tr>
<tr><td>Discuss naming in a DFS</td><td>The three schemes (host + local name &mdash; not location transparent; mounted remote directories &mdash; NFS; single global namespace), and the non-transparent versus transparent mapping.</td></tr>
<tr><td>Describe consistency in a DFS (4 marks)</td><td>The definition, why caching and replication force the problem, strict versus relaxed with ROWA at one end and NFS close-to-open with its 30-second window at the other, and the note that a cache consistency protocol is what makes caching safe.</td></tr>
<tr><td>Explain SUN NFS</td><td>Sun 1985, first commercially successful network file system, for diskless workstations, published protocol specifications, both implementation and specification, client&ndash;server with no dedicated server; stateless with self-contained requests for fast crash recovery; protocol on Sun RPC and XDR; the three-part file handle; remote mount, mount table, VFS/VNODE; uid/gid per request and Kerberos; the issue list.</td></tr>
<tr><td>Compare stateful and stateless services</td><td>The table in 4.2.2 &mdash; bookkeeping, performance and fault tolerance.</td></tr>
<tr><td>Explain the architecture of HDFS (4 marks)</td><td>Master&ndash;worker: NameNode managing the namespace with the namespace image and edit log on local disk and the block&ndash;datanode mapping in memory; DataNodes storing and serving blocks and sending periodic block reports; the client asking the NameNode for locations and reading data directly from a DataNode; blocks of 64/128 MB replicated three times.</td></tr>
<tr><td>How does HDFS ensure fault tolerance and scalability? (4 marks)</td><td>Fault tolerance: block replication (typically three, on physically separate machines), backup of the namenode's persistent state to multiple filesystems synchronously and atomically (local disk plus remote NFS), the secondary namenode merging the namespace image with the edit log, and HDFS high availability with active&ndash;standby namenodes, shared edit log, block reports to both, a failover controller using ZooKeeper, and fencing. Scalability: blocks larger than any single disk, federation adding namenodes each managing a portion of the namespace, and the observation that the in-memory metadata is what limits scaling.</td></tr>
<tr><td>What is GFS and how does it differ?</td><td>The assumptions (commodity hardware, large files, streaming reads, append-only writes, bandwidth over latency), the single master plus chunkservers, 64 MB chunks with 64-bit handles, 3&times; replication, the five-step read path, the three metadata types in memory, the operation log, and that data does not flow across the master.</td></tr>
<tr><td>What is middleware, and why is it needed?</td><td>The definition (services enabling interaction across a heterogeneous distributed system, above the network and below the application), the two jobs (network transparency, hiding hardware and OS details), and the reasons heterogeneity exists.</td></tr>
<tr><td>Explain CORBA</td><td>OMG 1989, a specification not a product, the ORB, requests as operation + target object + parameters, IDL with generated proxies and skeletons, static versus dynamic invocation, the object adapter, interface versus implementation repository, transient versus persistent IORs, GIOP/IIOP, and the services.</td></tr>
<tr><td>Explain MQTT and AMQP</td><td>MQTT as lightweight publish&ndash;subscribe for unreliable networks and IoT/M2M over TCP (with MQTT-SN over UDP/Bluetooth), broker/publisher/subscriber/topic, and the message format; AMQP as a binary application-layer protocol for M2M with interoperability as its focus, supporting both publish&ndash;subscribe and request&ndash;response with brokers and queues.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch4/chapter4-lecture-notes-all-s04-070.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch4/chapter4-lecture-notes-all-s04-070.webp" alt="The above figure provides an overview of types of storage systems, that work in  a distributed  environment." width="1136" height="642" loading="lazy" decoding="async">
<figcaption><strong>slide 4</strong> &middot; Chapter4_lecture_notes_all.pptx &mdash; The above figure provides an overview of types of storage systems, that work in  a distributed  environment.</figcaption>
</figure>
<!-- /dcc-fig -->

<!-- dcc-fig-extras:start -->
<h2>Extra pages from the GFS/HDFS lecture, not on the syllabus</h2>
<p>These four pages of <em>GFS_HDFS_Lecture.pdf</em> describe <strong>MapReduce job execution</strong> &mdash; the JobTracker and TaskTracker daemons, how a Hadoop job is split into map and reduce tasks, a Yahoo! cluster from 2010, and YARN replacing the JobTracker's two roles. The syllabus's Unit 4.2 is <strong>NFS, HDFS</strong> and nothing else: MapReduce, YARN, JobTracker and TaskTracker appear nowhere in the printed sub-topics, and no question on the Model Question 2025 asks about them. They are separated out for the same reason as the protocol slides above &mdash; the HDFS pages of this same lecture, the NameNode and DataNode ones, are in section 4.2.6 where they belong, and these are a different subject that the matcher had no home for.</p>
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p33.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p33.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 33" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 33</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p35.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p35.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 35" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 35</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p36.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p36.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 36" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 36</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch1/gfs-hdfs-lecture-p37.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch1/gfs-hdfs-lecture-p37.webp" alt="Diagram from GFS_HDFS_Lecture.pdf, page 37" width="1600" height="1236" loading="lazy" decoding="async">
<figcaption><strong>page 37</strong> &middot; GFS_HDFS_Lecture.pdf</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- /dcc-fig-extras -->


`,

  quiz: [
    {
      q: 'In the file service architecture, what is a UFID used for?',
      options: [
        'To encrypt a file before it crosses the network',
        'To refer to a file in all flat file service operations, uniquely among all files in the distributed system',
        'To identify which client has a file open',
        'To record the file\'s physical cylinder and sector'
      ],
      answer: 1,
      explanation: 'The flat file service is concerned with operations on file contents, and Unique File Identifiers are used to refer to files in all its requests. They are long sequences of bits chosen so that each file is unique among all the files in a distributed system. The directory service maps text names to UFIDs.'
    },
    {
      q: 'Which of the three DFS naming schemes is neither location transparent nor location independent?',
      options: [
        'Files named with a combination of host and local name',
        'Remote directories mounted to local directories',
        'A single global name structure spanning all files',
        'Naming by UFID alone'
      ],
      answer: 0,
      explanation: 'Host + local name guarantees uniqueness but names the location, so it is neither transparent nor independent, and the DFS is a loose collection of independent file systems. Mounted remote directories are location independent (SUN NFS), and a single global name structure is the strongest illusion of one system.'
    },
    {
      q: 'Why does a transparent naming mapping insert a file identifier between the name and the physical location?',
      options: [
        'To make file names shorter',
        'So that when the physical location changes, only the file identifier needs to be modified',
        'To allow files to be encrypted',
        'Because physical addresses cannot be stored in a directory'
      ],
      answer: 1,
      explanation: 'Non-transparent: name → <system, disk, cylinder, sector>. Transparent: name → file identifier → <system, disk, cylinder, sector>. The extra level is what makes relocation invisible, which is why the identifier must be unique.'
    },
    {
      q: 'What is the essential difference between a stateful and a stateless file service?',
      options: [
        'A stateful server is always faster in every respect',
        'A stateful server keeps information about client requests; a stateless server requires each request to be self-contained',
        'A stateless server cannot cache anything',
        'A stateful server cannot tolerate any client failure'
      ],
      answer: 1,
      explanation: 'A stateful server tracks open files, connection identifiers and caches, and must reclaim memory when a client closes a file or dies; performance is better because the filename need not be parsed each time. A stateless server has self-contained requests and, crucially, remembers nothing, so it starts easily after a crash.'
    },
    {
      q: 'A SUN NFS file handle consists of:',
      options: [
        'A filename and a file offset',
        'A filesystem id, an i-node number and a generation number',
        'A host name, a port number and a password',
        'A UFID and a user id'
      ],
      answer: 1,
      explanation: 'The filesystem id identifies the disk partition, the i-node number identifies the file within the partition, and the generation number changes every time the i-node is reused — which is what prevents a stale handle from addressing a different file. The server keeps the filesystem id in the superblock and the generation number in the i-node.'
    },
    {
      q: 'Why must an NFS server check the user\'s identity and access rights on every request?',
      options: [
        'Because the protocol encrypts nothing',
        'Because it is a stateless server, so it holds no record of the client between calls',
        'Because UNIX permissions are checked by the client',
        'Because the server caches file blocks'
      ],
      answer: 1,
      explanation: 'Statelessness means there is no session to check at. So every client request is accompanied by the userID and groupID, inserted by the RPC system, and Kerberos has been integrated with NFS to give a stronger security solution. This also explains the requirement that uid and gid map identically on all machines.'
    },
    {
      q: 'Which is a stated issue with SUN NFS?',
      options: [
        'It requires a dedicated server on every network',
        'It has no file locking, and its UNIX semantics are not always preserved',
        'It cannot run on low-end machines',
        'It stores client state so recovery after a crash is slow'
      ],
      answer: 1,
      explanation: 'The deck lists: root file systems cannot be shared; clients can mount the same subtree in different places, giving it different names; uid/gid mapping must be identical everywhere; there is no file locking; and an open file removed by another client is immediately deleted. NFS needs no dedicated server and is stateless, which is what gives it fast crash recovery.'
    },
    {
      q: 'In HDFS, which node holds the block-to-datanode mapping?',
      options: [
        'Each DataNode holds its own complete copy of the mapping',
        'The NameNode, in memory, along with the namespace and metadata',
        'The client caches it permanently',
        'The secondary namenode'
      ],
      answer: 1,
      explanation: 'The NameNode is the master: it manages the filesystem namespace, maintains the tree and the metadata for all files and directories, and knows which datanodes hold the blocks for a given file. Its persistent state on local disk is the namespace image and the edit log. Because the mapping is in memory, the number of files is limited by the NameNode\'s memory.'
    },
    {
      q: 'What is the main role of the secondary namenode in normal operation?',
      options: [
        'It serves client requests in parallel with the primary namenode',
        'It periodically merges the namespace image with the edit log so the edit log does not grow too large',
        'It stores copies of every block',
        'It replaces the failover controller'
      ],
      answer: 1,
      explanation: 'Despite its name it does not act as a namenode. Its main role is checkpointing — periodically merging the namespace image with the edit log — though it can be shaped to act as the primary namenode if needed. Genuine automatic failover is HDFS high availability, with an active-standby pair.'
    },
    {
      q: 'Why are HDFS blocks so large (64 MB, often 128 MB)?',
      options: [
        'To reduce the number of datanodes needed',
        'To minimise the cost of seeks, so transfer time dominates seek time',
        'Because the namenode cannot address smaller blocks',
        'To make replication unnecessary'
      ],
      answer: 1,
      explanation: 'With a seek time of about 10 ms and a transfer rate of 100 MB/s, making the block about 100 MB makes the seek 1% of the transfer time, so a multi-block file transfers at the disk transfer rate. The other benefits of the block abstraction are that a file can exceed one disk, storage management simplifies, and blocks suit replication.'
    },
    {
      q: 'How long can a cold start of a new NameNode take on a large cluster?',
      options: [
        'A few seconds',
        'About two minutes',
        '30 minutes or more',
        'It is instantaneous because metadata is in memory'
      ],
      answer: 2,
      explanation: 'The new namenode cannot serve requests until it has loaded its namespace image, replayed its edit log, and received enough block reports to leave safe mode — 30 minutes or more on large clusters. That delay is the motivation for HDFS high availability, where a standby namenode takes over without significant interruption.'
    },
    {
      q: 'In HDFS high availability, which architectural change is needed because block mappings live in memory?',
      options: [
        'Clients must send block reports',
        'Datanodes must send block reports to both namenodes',
        'The edit log must be kept on each datanode',
        'Blocks must be replicated twice instead of three times'
      ],
      answer: 1,
      explanation: 'Three changes are needed: the namenodes share the edit log via highly available shared storage; datanodes send block reports to both namenodes, since the mappings are in memory and not on disk; and clients must handle failover transparently. A failover controller — the first implementation using ZooKeeper — ensures only one namenode is active, and fencing prevents the old active node from causing corruption.'
    },
    {
      q: 'What does HDFS Federation add?',
      options: [
        'Automatic replication of the namenode',
        'Multiple namenodes, each managing a portion of the filesystem namespace, to scale past in-memory metadata limits',
        'A second copy of every block in a remote site',
        'A single global namespace shared by all namenodes'
      ],
      answer: 1,
      explanation: 'Federation (0.23 series) lets a cluster scale by adding namenodes — one managing /user, another /share, for example. Namespace volumes are independent, namenodes do not communicate, and one failing does not affect the others; but block pool storage is not partitioned, so datanodes register with every namenode.'
    },
    {
      q: 'In GFS, which statement about the master is correct?',
      options: [
        'All file data passes through the master for security',
        'Data does not flow across the master: the client asks for chunk locations and reads data from a chunkserver directly',
        'The master stores no metadata, only chunk data',
        'The master keeps a persistent record of chunk replica locations'
      ],
      answer: 1,
      explanation: 'The client translates the filename and offset into a chunk index, asks the master, receives the chunk handle and locations, caches that metadata, then talks to the closest replica directly for bytes. The master does not keep a persistent record of chunk replica locations — it polls chunkservers at startup and relies on heartbeats, so the chunkserver has the final word over what chunks it has.'
    },
    {
      q: 'Which is true of CORBA?',
      options: [
        'CORBA is a programming language for distributed objects',
        'CORBA is a specification published by the OMG; there are products that implement it to some extent',
        'CORBA is a product sold by OMG',
        'CORBA replaces the need for an IDL'
      ],
      answer: 1,
      explanation: 'OMG, a non-profit consortium formed in 1989, develops and promotes standards; CORBA is the specification of the Object Request Broker, detailing middleware functions that let objects communicate regardless of location, designer or language. OMG provides only the specification, and an IDL is central to it — proxies and skeletons are generated by compiling the IDL.'
    },
    {
      q: 'Which repository does a CORBA object adapter use to resolve an incoming call and activate the right object method?',
      options: [
        'The interface repository',
        'The implementation repository',
        'The naming service',
        'The transaction service'
      ],
      answer: 1,
      explanation: 'The implementation repository maps object adapter names to the pathnames of files containing object implementations, plus the hostname and port of the running server, and the object adapter uses it to activate the right method via a skeleton. The interface repository holds IDL interface descriptions and is what makes dynamic invocation possible.'
    },
    {
      q: 'In MQTT, what is the broker\'s role?',
      options: [
        'It publishes messages on behalf of devices',
        'It receives data from publishers and forwards it to the interested subscribers',
        'It stores all messages permanently',
        'It translates MQTT into HTTP'
      ],
      answer: 1,
      explanation: 'The broker sits between publishers (clients that send data to it) and subscribers (clients registered with it to receive updates from specific sources). The publisher never names a receiver and the subscriber never names a sender — the broker decouples them, which is what suits intermittent connectivity.'
    },
    {
      q: 'Which is a difference between MQTT and AMQP as described in the deck?',
      options: [
        'MQTT supports request-response only; AMQP supports publish-subscribe only',
        'MQTT is publish-subscribe over TCP for lightweight and unreliable networks; AMQP is a binary application-layer protocol focused on interoperability, supporting both publish-subscribe and request-response',
        'AMQP cannot use queues',
        'MQTT is used only in corporate environments'
      ],
      answer: 1,
      explanation: 'MQTT is the lightweight publish-subscribe protocol for IoT/M2M over TCP (MQTT-SN can use UDP or Bluetooth); its message format is a 1-byte control header plus a 1-to-4-byte length, an optional variable header and an optional payload. AMQP is the binary application-layer protocol generally used in corporate environments, focused on interoperability, with brokers and queues.'
    }
  ],

  past: [
    {
      year: 'Final 2025',
      marks: '4',
      repeats: 1,
      q: 'Define transparency in DFS and explain naming transparency.',
      occ: [
        { year: 'Final 2025', marks: '4', q: 'Define transparency in DFS and explain naming transparency.' }
      ],
      answer: `
<h4>Model answer &mdash; 4 marks</h4>
<p><strong>Transparency</strong> in a distributed file system is the property that the
distribution is invisible to the user: the file service behaves like a single local file
system even though the files are spread over several servers. The unit names the kinds worth
remembering &mdash; <em>access</em> (a local call and a remote one look the same),
<em>location</em> (you do not know where the file is), <em>migration</em>, <em>replication</em>
(copies exist but only one is visible), <em>concurrency</em> (two users' operations do not
interleave damagingly) and <em>failure</em>.</p>
<p><strong>Naming transparency</strong> is the specific case of <em>location</em>: the name a
client uses to open a file must not disclose, or depend on, the server that holds it. The unit
contrasts three schemes, and the examinable distinction is which of them is transparent:</p>
<ul>
<li><strong>Machine + path name</strong> (e.g. <code>/server/files/x.c</code> or a host in the
mount) &mdash; neither location transparent nor location independent: the server is named by the
client, and moving the file breaks every reference.</li>
<li><strong>Mounting a remote directory onto a local one</strong> &mdash; location transparent
once mounted, because the client sees a local path, but not location independent: the local
mount point still has to exist and be configured per client.</li>
<li><strong>A single global namespace</strong> (one NameNode, as in HDFS, or a single
<em>UFID</em>-based file service) &mdash; both location transparent and location independent:
the name is the same everywhere, and no client needs to know or be configured with a server.</li>
</ul>
<div class="concept-box tip">
<h4>Where this came from</h4>
<p>Group B, question 3 of the <em>2025 Final Exam</em>, 4 marks. The answer is marked in two
halves &mdash; the definition of transparency, then naming transparency with the three schemes
&mdash; and the third scheme's argument (location independent as well as transparent) is what
separates a 4 from a 2. The same distinction is section 4.1.4 of this unit's notes.</p>
</div>
`
    },
    {
      year: 'Final 2025',
      marks: '8',
      repeats: 1,
      q: 'Define Middleware. Explain the concepts related to CORBA with its architecture and services in detail.',
      occ: [
        { year: 'Final 2025', marks: '8', q: 'Define Middleware. Explain the concepts related to CORBA with its architecture and services in detail.' }
      ],
      answer: `
<h4>Model answer &mdash; 8 marks</h4>
<p><strong>Middleware</strong> is a software layer that sits between the applications and the
network and hides the heterogeneity of the machines underneath: different operating systems,
different programming languages and different data representations. It is what makes an
application portable across the nodes of a distributed system and interoperable with
applications on other nodes, without each application re-implementing the network itself.
Its other job is the one the unit's own heading uses &mdash; it is the layer that provides
distribution transparency.</p>
<p><strong>CORBA</strong> &mdash; the Common Object Request Broker Architecture, standardised by
the OMG &mdash; is object-based middleware. The application sees a set of remote objects with
interfaces written in <strong>IDL</strong> (Interface Definition Language), which is
language-neutral by design: the IDL is compiled into a stub in whatever language each side is
written in, and the wire format is agreed separately from both.</p>
<p><strong>The architecture, in one pass.</strong> A client holds an <strong>object
reference</strong> and calls a method on it through a <strong>client stub</strong> (proxy) that
marshals the arguments. The call reaches the <strong>ORB core</strong>, which is the bus: it
locates the object and transfers the request. On the server side the <strong>object
adapter</strong> (the portable POA) maps the reference onto an implementation and dispatches to
the <strong>skeleton</strong>, which unmarshals the arguments and invokes the real method. The
<strong>ORB</strong> itself is the middleware component that makes location transparent, and the
<strong>Interface Repository</strong> and <strong>Implementation Repository</strong> answer
"what does this interface look like" and "where is this object activated".</p>
<p><strong>Services</strong> are the standardised facilities layered above the ORB, of which the
examinable ones are: <em>naming</em> (bind names to object references, so a client does not
hard-code a location), <em>life cycle</em>, <em>trading</em> (find a service by its
properties rather than its name), <em>event</em> and <em>notification</em> (asynchronous
many-to-many delivery), and <em>transaction</em> (the two-phase commit that spans objects on
several hosts).</p>
<div class="concept-box tip">
<h4>Marking this one</h4>
<p>Group C, question 2 of the <em>2025 Final Exam</em>, 8 marks, and the wording lists its own
parts: definition, CORBA concepts, architecture, services. Treat it as four short answers.
The marks are lost by writing only the architecture &mdash; a page on the ORB and the POA with
nothing on naming or the transaction service cannot reach 8, because three of the four
requested parts are missing.</p>
</div>
`
    },
    {
      year: 'Model 2025',
      marks: '4',
      repeats: 1,
      q: 'Describe the concept of consistency in Distributed File Systems (DFS).',
      occ: [
        { year: 'Model 2025', marks: '4', q: 'Describe the concept of consistency in Distributed File Systems (DFS).' }
      ],
      answer: `
<h4>Model answer &mdash; 4 marks</h4>
<p><strong>Definition.</strong> Consistency is the requirement that <strong>when a file is cached or replicated, every client that reads it observes the effects of updates according to a defined rule</strong>. It is one of the DFS design goals &mdash; alongside transparency, concurrency, replication, heterogeneity, fault tolerance, security and efficiency &mdash; and it exists as a problem because a DFS deliberately keeps <strong>more than one copy</strong> of data: replicas on servers for availability, and cached blocks on clients for performance. A write to one copy does not automatically reach the others, so consistency is the contract that says how soon and in what order it does.</p>

<p><strong>Why it is unavoidable.</strong> The client module of the file service architecture <strong>caches recently used file blocks</strong> to get acceptable performance, and the DFS comparison table records a cache consistency strategy for every system in it &mdash; NFS, Coda, Plan 9 and xFS use <strong>write-back</strong>, SFS writes through. Write-back is faster and leaves a window in which the cache is wrong. Replication adds the second source of copies: the naming mapping for a replicated file returns <strong>a set of locations for the replicas</strong>, so the rule must also say what happens when concurrent clients write to different copies.</p>

<p><strong>Strict consistency.</strong> Every read sees the most recent write immediately, everywhere. It requires writes to be propagated synchronously to every copy before the write completes and no client cache to be trusted, so its cost is latency on every write proportional to the number of copies. <strong>Read-one/write-all (ROWA)</strong> replication is the strict design in the DFS comparison table, used by Coda.</p>

<p><strong>Relaxed (weaker) consistency.</strong> A read may see an older version for a bounded, defined period or until a defined event occurs.</p>
<ul>
<li><strong>SUN NFS</strong> uses a <strong>close-to-open</strong> model: cached updates are <strong>not visible to other processes until the file is closed</strong>, at which point the client flushes them. Most installations operate with a <strong>consistency window of 30 seconds</strong> between client and server, which is how long a client may keep using cached data before revalidating it (Coulouris, <em>Distributed Systems: Concepts and Design</em>, Section 12.3 &mdash; the deck's own comparison table records NFS's cache consistency as write-back).</li>
<li><strong>GFS and HDFS</strong> are relaxed in a different way: files are <strong>write-once, read-many, with writes appended at the end</strong>, and no support for modification at arbitrary offsets &mdash; which removes most of the concurrent-update problem by construction.</li>
</ul>

<p><strong>Concluding point.</strong> A <strong>cache consistency protocol is what makes caching safe</strong>, and choosing it is choosing between the two rows above: write-back with revalidation, or write-through at the cost of performance. Consistency also interacts with the failure model &mdash; NFS is stateless, so a crashed server needs no recovery state, but a stateless server cannot remember that a client holds a file, which is one reason it has no file locking and does not perfectly preserve UNIX semantics.</p>

<div class="concept-box tip">
<h4>Where this came from</h4>
<p>Group B, question 9 of the <em>Model Question 2025</em>, worth 4 marks. Structure it as: definition &rarr; why caching and replication force it &rarr; strict vs relaxed with one named example each &rarr; the NFS number. The 30-second window is the detail that shows you read the textbook rather than only the slides.</p>
</div>`
    },
    {
      year: 'Model 2025',
      marks: '8',
      repeats: 1,
      q: 'Explain the architecture of HDFS. Discuss how it ensures fault tolerance and scalability. [4+4]',
      occ: [
        { year: 'Model 2025', marks: '8', q: 'Explain the architecture of HDFS. Discuss how it ensures fault tolerance and scalability. [4+4]' }
      ],
      answer: `
<h4>Model answer &mdash; 8 marks</h4>

<p><strong>Part 1 &mdash; Architecture (4 marks).</strong> HDFS is <strong>a distributed file system designed for storing very large files with streaming data access patterns, running on clusters of commodity hardware</strong>. It exists because <strong>when a dataset outgrows the storage capacity of a single machine it must be partitioned across several, and file systems that manage storage across a network of machines are distributed file systems</strong>. Its assumptions are <strong>very large files</strong> (hundreds of MB to TB or PB), <strong>streaming access</strong> under a write-once, read-many-times pattern, and <strong>commodity hardware</strong>, for which <strong>the chance of node failure across the cluster is high</strong> and in the face of which HDFS is designed to keep working without noticeable interruption.</p>

<p><strong>Blocks.</strong> Files are <strong>broken into block-sized chunks stored as independent units</strong>, <strong>64 MB by default (many installations use 128 MB)</strong>. The large size is to <strong>minimise the cost of seeks</strong>: with a 10 ms seek and 100 MB/s transfer, a block of about 100 MB makes the seek 1% of the transfer time, so multi-block files transfer at the disk rate. Blocks give three benefits: <strong>a file can be larger than any single disk</strong>, since blocks need not be co-located; <strong>the storage subsystem deals in blocks rather than files</strong>, simplifying management and eliminating metadata concerns; and <strong>blocks fit replication</strong>, since each block can be copied to a few physically separate machines.</p>

<p><strong>Master&ndash;worker nodes.</strong> An HDFS cluster has <strong>two types of node in a master&ndash;worker pattern</strong>:</p>
<ul>
<li><strong>NameNode (master)</strong> &mdash; manages the <strong>filesystem namespace</strong>, maintaining <strong>the filesystem tree and the metadata for all files and directories</strong>, persisted on local disk as <strong>the namespace image and the edit log</strong>. It also <strong>determines the mapping of blocks to DataNodes</strong> and regulates client access: opening, closing and renaming files and directories.</li>
<li><strong>DataNodes (slaves/workers)</strong> &mdash; the <strong>workhorses of the filesystem</strong>: they <strong>store and retrieve blocks when told to</strong> by clients or the NameNode, and <strong>report back periodically with lists of the blocks they are storing</strong>, performing <strong>block creation, deletion and replication on instruction from the NameNode</strong>.</li>
</ul>
<p><strong>The client asks the NameNode for metadata and then reads or writes block data directly to DataNodes</strong> &mdash; <strong>data does not flow through the NameNode</strong> (the same separation as GFS, where the client translates the filename and offset into a chunk index, the master replies with the chunk handle and locations, the client caches that metadata, and then requests bytes from the closest replica). The wider cluster follows the same shape: <strong>Master: NameNode, JobTracker; Slave: {DataNode, TaskTracker}</strong>.</p>

<p><strong>Part 2 &mdash; Fault tolerance and scalability (4 marks).</strong></p>
<p><em>Fault tolerance.</em> First, <strong>block replication</strong>: each block is replicated to a small number of <strong>physically separate machines, typically three</strong>, to insure against corrupted blocks and disk and machine failure. Second, the NameNode is <strong>a single point of failure</strong> &mdash; <strong>if it fails, all files would be lost, because there is no way of knowing how to reconstruct them from the blocks on the DataNodes</strong>, and all clients including MapReduce jobs could not read, write or list files. Three remedies:</p>
<ul>
<li><strong>Backup of the persistent metadata state</strong> &mdash; the NameNode can be configured to write its persistent state to <strong>multiple filesystems</strong>, with <strong>synchronous and atomic</strong> writes, usually <strong>local disk plus a remote NFS mount</strong>.</li>
<li><strong>The secondary namenode</strong> &mdash; despite its name it does not act as a namenode: it <strong>periodically merges the namespace image with the edit log so the edit log does not become too large</strong>, and can be shaped to act as the primary if needed.</li>
<li><strong>HDFS high availability</strong> (0.23) &mdash; <strong>a pair of namenodes in an active&ndash;standby configuration</strong>, where the standby <strong>takes over without significant interruption</strong>. This needs three changes: the namenodes <strong>share the edit log through highly available shared storage</strong>; <strong>DataNodes send block reports to both namenodes</strong>, because the mappings are in memory and not on disk; and <strong>clients handle failover transparently</strong>. A <strong>failover controller</strong> manages the transition &mdash; the first implementation uses <strong>ZooKeeper to ensure only one namenode is active</strong> &mdash; and may be <strong>graceful</strong> when an administrator triggers it for maintenance, or ungraceful, in which case <strong>fencing</strong> prevents the old active namenode from causing damage or corruption. Without HA, a cold start requires loading the namespace image, replaying the edit log and receiving block reports to leave safe mode, which can take <strong>30 minutes or more</strong>.</li>
</ul>

<p><em>Scalability.</em> The block abstraction lets <strong>a file be larger than any single disk</strong>, and the separation of metadata from data lets one master serve a very large cluster because <strong>data never flows through it</strong>. The limiting factor is that <strong>the NameNode keeps a reference to every file and block in memory</strong>, so memory governs how far a cluster can scale &mdash; and <strong>HDFS Federation (0.23) addresses this by allowing a cluster to scale by adding namenodes, each managing a portion of the filesystem namespace</strong> (one for <code>/user</code>, another for <code>/share</code>), with <strong>independent namespace volumes that do not communicate and whose failures do not affect each other</strong>, while <strong>block pool storage is not partitioned</strong> so DataNodes register with every namenode. Replication is also what makes scaling safe: adding commodity machines adds both capacity and the redundancy to lose some of them.</p>

<p><em>Also worth a line:</em> HDFS is deliberately <strong>not a good fit for low-latency access</strong> (tens of milliseconds), <strong>lots of small files</strong> (the number of files is governed by NameNode memory), or <strong>multiple writers and arbitrary file modifications</strong> (single writer, writes always at the end of the file).</p>

<div class="concept-box tip">
<h4>Where this came from</h4>
<p>Group C, question 16 of the <em>Model Question 2025</em>, marked <strong>[4+4]</strong> &mdash; two halves of 4 marks each. Answer it in two headed parts and draw Fig 4.2 for the architecture. The fault-tolerance half needs the four mechanisms by name: three-way block replication, multi-filesystem backup of the NameNode state, the secondary namenode, and high availability with shared edit log, dual block reports, ZooKeeper-based failover control and fencing. The scalability half is federation plus the in-memory metadata limit.</p>
</div>`
    }
  ]
};

;
/* ch5.js */
/* Chapter 5 — Introduction to Cloud Computing.

   Syllabus unit 5: 4 hours, 6 marks. Sub-topics 5.1 History and evolution of
   cloud, 5.2 Characteristics and benefits, 5.3 Cloud service models
   (IaaS, PaaS, SaaS), 5.4 Cloud deployment models (Public, Private, Hybrid,
   Community).

   Written from Er. Avijit Karn's 37-slide Chapter 5 deck, read into
   `_source/dcc/lecture_notes_all_chapterwise_ch_5_int_to_cloudcomputing.txt`
   by tools/dcc_extract.py. This deck was the legacy `.ppt` format, so it was
   converted through PowerPoint and then OCR'd — its figures are pictures, and
   the recovered labels (the evolution timeline, the four deployment models'
   security perimeters, the service-model stack and the advantage/disadvantage
   panel) are what the figures in this chapter are drawn from.

   Three Model Question 2025 questions sit in this unit: Group A question 2
   (IaaS versus PaaS, 2 marks), Group B question 10 (features and benefits of
   cloud computing, 4 marks) and Group C question 13 (the four deployment
   models compared, 8 marks). */

window.CHAPTERS = window.CHAPTERS || {};
window.CHAPTERS[5] = {
  learn: `

<h2>Unit 5 &mdash; Introduction to Cloud Computing</h2>
<p class="unit-meta">Syllabus: 4 hours &middot; 6 marks &middot; sub-topics 5.1&ndash;5.4</p>

<p>Read the unit in the order the deck builds it: <strong>5.1</strong> says where cloud computing came from and what it is made of, <strong>5.2</strong> says what makes it cloud rather than hosting, and <strong>5.3</strong> and <strong>5.4</strong> are the two classifications every question draws on &mdash; what the provider supplies (delivery models) and who controls it (deployment models). The vocabulary of this unit is what Units 6 to 9 are written in, so a term you do not fix here will reappear unexplained later.</p>

<div class="concept-box asked">
<h4>What this unit is worth in the exam</h4>
<ul>
<li><strong>2 marks</strong> &mdash; &ldquo;What is the difference between IaaS and PaaS?&rdquo; (<em>Group A, question 2</em>)</li>
<li><strong>4 marks</strong> &mdash; &ldquo;What are the key features and benefits of cloud computing?&rdquo; (Group B, question 10)</li>
<li><strong>8 marks</strong> &mdash; &ldquo;Compare and contrast the public, private, hybrid, and community cloud deployment models with suitable use cases.&rdquo; (<em>Group C, question 13</em>)</li>
</ul>
<p><strong>14 marks &mdash; the largest single-unit total on the paper.</strong> Note that the Group C question says <em>compare and contrast</em> and <em>with suitable use cases</em>: a table alone loses marks, so 5.4.3 gives the table and 5.4.4 gives the use cases, and the answer needs both halves. Unit 6's hypervisor question and Unit 8's security question both build on vocabulary introduced here.</p>
</div>

<h2>5.1 History and evolution of cloud computing</h2>

<h3>5.1.1 What cloud computing is &mdash; two definitions to quote</h3>
<p>The deck opens with a definition from Wikipedia and one from Microsoft Azure, and quoting both is a good way to open an answer because they say different things. The infrastructure definition:</p>

<div class="concept-box key">
<p>&ldquo;<strong>Cloud computing is an information technology (IT) paradigm that enables ubiquitous access to shared pools of configurable system resources and higher-level services that can be rapidly provisioned with minimal management effort, often over the Internet.</strong> Cloud computing relies on sharing of resources to achieve coherence and <strong>economies of scale, similar to a public utility</strong>.&rdquo;
&mdash; the deck's Wikipedia definition</p>
<p>&ldquo;Simply put, cloud computing is <strong>the delivery of computing services &mdash; servers, storage, databases, networking, software, analytics and more &mdash; over the Internet ("the cloud")</strong>. Companies offering these computing services are called <strong>cloud providers</strong> and typically <strong>charge for cloud computing services based on usage, similar to how you are billed for gas or electricity at home</strong>.&rdquo;
&mdash; the deck's Azure definition</p>
</div>

<p>Read together, the first names the mechanism (<strong>shared pools of configurable resources, rapidly provisioned</strong>) and the second names the business model (<strong>delivery of services, metered by usage like a utility</strong>). The utility analogy is not decoration: it is the defining attribute in 5.2, and it is what separates cloud computing from a hosting service.</p>

<h3>5.1.2 The basic reasoning and the two early models</h3>
<p>The reasoning behind cloud computing, in one sentence from the deck: <strong>information and data processing can be done more efficiently on large farms of computing and storage systems accessible via the Internet</strong>. That idea produced two earlier models, and the exam likes the distinction between them:</p>

<table class="comparison-table">
<thead>
<tr><th></th><th>Grid computing</th><th>Utility computing</th></tr>
</thead>
<tbody>
<tr><td><strong>When</strong></td><td>Initiated by the National Labs in the <strong>early 1990s</strong>.</td><td>Initiated in <strong>2005&ndash;2006</strong> by IT companies.</td></tr>
<tr><td><strong>Target</strong></td><td><strong>Scientific computing</strong>, primarily.</td><td><strong>Enterprise computing.</strong></td></tr>
<tr><td><strong>Definition</strong></td><td>&ldquo;<strong>Grid computing is the collection of computer resources from multiple locations to reach a common goal.</strong> The grid can be thought of as a distributed system with <strong>non-interactive workloads</strong> that involve a large number of files.&rdquo;</td><td>&ldquo;<strong>Utility computing is a service provisioning model in which a service provider makes computing resources and infrastructure management available to the customer as needed, and charges them for specific usage rather than a flat rate.</strong>&rdquo;</td></tr>
<tr><td><strong>What it contributes to cloud</strong></td><td>The idea of pooling resources from multiple locations for one goal &mdash; the unit of work is a batch job, not an interactive service.</td><td>The idea of <strong>renting by usage</strong> instead of buying &mdash; the utility billing model.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch5/ref-cloudcomptng-s17-121.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s17-121.webp" alt="In a basic grid computing system, every computer can access the resources of every other computer belonging to the network." width="400" height="400" loading="lazy" decoding="async">
<figcaption><strong>slide 17</strong> &middot; Ref_CloudComptng.pptx &mdash; In a basic grid computing system, every computer can access the resources of every other computer belonging to the network.</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>5.1.3 The five technologies, and the timeline</h3>
<p>The deck states the history in one paragraph worth reproducing almost verbatim: <strong>cloud computing is all about renting computing services, and this idea first came in the 1950s. In making cloud computing what it is today, five technologies played a vital role: distributed systems and their peripherals, virtualization, Web 2.0, service orientation, and utility computing.</strong></p>

<p>What each of the five contributes is worth one line of its own, because the list is really asking what a cloud is <em>made of</em>. <strong>Distributed systems and their peripherals</strong> are what allow one service to run across many machines at all (Unit 1). <strong>Virtualization</strong> supplies the isolation and multiplexing that let a provider sell slices of one machine to unrelated customers, which is the subject of Unit 6. <strong>Web 2.0</strong> supplies the always-reachable, browser-based interface, so that a user needs nothing installed. <strong>Service orientation</strong> supplies the interface idea itself &mdash; functionality that is called over a network rather than installed locally (Unit 2.4 and the delivery models in 5.3). <strong>Utility computing</strong> supplies the pricing: the shift from buying a machine to paying for what you use. The deck dates the arrival of the result at 2007, and it is the last two of the five that make it a <em>service</em> rather than a very large cluster.</p>

<figure class="figure-wide figure-wrap">
<svg class="figure wide" viewBox="0 0 820 280" role="img" aria-label="Timeline of the evolution of cloud computing from mainframe computing in the 1950s through cluster and grid computing, distributed systems, virtualization, Web 2.0, service orientation and utility computing, arriving at cloud computing in 2007">
<defs><marker id="f5a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="flow-arrow-head"/></marker></defs>

<path class="flow-arrow" d="M40,196 H800" marker-end="url(#f5a)"/>

<rect class="flow-box phase4" x="30" y="150" width="96" height="36" rx="8"/>
<text class="flow-label" x="78" y="173" text-anchor="middle">1950s</text>

<rect class="flow-box phase1" x="150" y="96" width="120" height="40" rx="8"/>
<text class="flow-label" x="210" y="120" text-anchor="middle">Mainframe</text>
<rect class="flow-box phase1" x="150" y="150" width="120" height="36" rx="8"/>
<text class="flow-label" x="210" y="173" text-anchor="middle">Cluster</text>

<rect class="flow-box phase2" x="296" y="60" width="120" height="40" rx="8"/>
<text class="flow-label" x="356" y="84" text-anchor="middle">Grid computing</text>
<rect class="flow-box phase2" x="296" y="150" width="150" height="36" rx="8"/>
<text class="flow-label" x="371" y="173" text-anchor="middle">Distributed systems</text>

<rect class="flow-box phase3" x="466" y="96" width="130" height="40" rx="8"/>
<text class="flow-label" x="531" y="120" text-anchor="middle">Virtualization</text>
<rect class="flow-box phase3" x="466" y="150" width="130" height="36" rx="8"/>
<text class="flow-label" x="531" y="173" text-anchor="middle">Web 2.0</text>

<rect class="flow-box phase4" x="622" y="60" width="140" height="40" rx="8"/>
<text class="flow-label" x="692" y="84" text-anchor="middle">Service orientation</text>
<rect class="flow-box phase4" x="622" y="150" width="140" height="36" rx="8"/>
<text class="flow-label" x="692" y="173" text-anchor="middle">Utility computing</text>

<rect class="flow-box phase1" x="622" y="212" width="140" height="44" rx="9"/>
<text class="flow-text" x="692" y="240">Cloud computing</text>
<path class="flow-arrow" d="M692,188 V208" marker-end="url(#f5a)"/>
<text class="flow-label" x="692" y="50" text-anchor="middle" opacity="0.85">2007</text>

<text class="flow-label" x="400" y="30" text-anchor="middle">Five technologies made cloud computing possible: distributed systems and their peripherals, virtualization,</text>
<text class="flow-label" x="400" y="248" text-anchor="middle">Web 2.0, service orientation, and utility computing.</text>
</svg>
<figcaption><strong>Fig 5.1 &mdash; The evolution, as the deck draws it</strong> (its slide 5). Mainframe computing in the 1950s, then cluster and grid computing, distributed systems, virtualization, Web 2.0, service orientation and utility computing, arriving at <strong>cloud computing in 2007</strong>. The arrow of the timeline is a dependency chain, not just a date order: each stage supplies something the next needs &mdash; virtualization supplies the isolation and multiplexing, service orientation supplies the interface, and utility computing supplies the pricing.</figcaption>
</figure>
<!-- dcc-fig:ch5/ch-5-int-to-cloudcomputing-s05-161.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ch-5-int-to-cloudcomputing-s05-161.webp" alt="Diagram from Ch_5_Int_to_CloudComputing.ppt, slide 5" width="1264" height="867" loading="lazy" decoding="async">
<figcaption><strong>slide 5</strong> &middot; Ch_5_Int_to_CloudComputing.ppt</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>5.1.4 The three axes of cloud computing</h3>
<p>The deck's slide 2 is a map of the whole unit, and it is worth reproducing because an exam question that says "explain cloud computing models" is asking for these three rows:</p>

<p>Read the table as the skeleton of any “explain cloud computing models” answer, because it separates three things that are easy to blur together: <strong>what the provider supplies and what you pay for</strong> (the delivery models, 5.3), <strong>who controls the infrastructure and where it sits</strong> (the deployment models, 5.4), and <strong>what makes it cloud rather than ordinary hosting</strong> (the defining attributes, 5.2 &mdash; utility pricing, Internet access and elasticity). A question that asks for “types of cloud” without naming an axis can be answered on any of the three, so the marks come from saying which axis you are using and sticking to it. 5.4.2 exists to keep the first two apart, and it is worth reading before the delivery models.</p>
<table class="comparison-table">
<thead>
<tr><th>Axis</th><th>Values</th><th>Covered in</th></tr>
</thead>
<tbody>
<tr><td><strong>Delivery (service) models</strong><br><span class="muted">what the provider supplies</span></td><td><strong>Software as a Service (SaaS), Platform as a Service (PaaS), Infrastructure as a Service (IaaS)</strong></td><td>5.3</td></tr>
<tr><td><strong>Deployment models</strong><br><span class="muted">who the cloud is for and where the control sits</span></td><td><strong>Public cloud, Private cloud, Community cloud, Hybrid cloud</strong></td><td>5.4</td></tr>
<tr><td><strong>Defining attributes</strong></td><td><strong>Utility computing / pay-per-usage; accessible via the Internet; elasticity</strong></td><td>5.2</td></tr>
<tr><td><strong>Resources the cloud is built from</strong></td><td>Distributed infrastructure, resource virtualization, autonomous systems, compute and storage servers, networks, applications</td><td>Unit 6</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch5/ch-5-int-to-cloudcomputing-s26-165.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ch-5-int-to-cloudcomputing-s26-165.webp" alt="The Three delivery/Service models of Cloud Computing" width="550" height="383" loading="lazy" decoding="async">
<figcaption><strong>slide 26</strong> &middot; Ch_5_Int_to_CloudComputing.ppt &mdash; The Three delivery/Service models of Cloud Computing</figcaption>
</figure>
<!-- /dcc-fig -->
<h2>5.2 Characteristics and benefits</h2>

<h3>5.2.1 The defining characteristics</h3>
<p>The deck quotes the defining sentence and then breaks it down. The sentence: <strong>&ldquo;Cloud Computing offers on-demand, scalable and elastic computing (and storage services). The resources used for these services can be metered and users are charged only for the resources used.&rdquo;</strong> The breakdown is four points, and this is the skeleton of the Group B answer in 5.2.3:</p>
<ul>
<li><strong>Shared resources and resource management</strong> &mdash; the cloud uses <strong>a shared pool of resources</strong>.</li>
<li><strong>Internet technology for scalable and elastic services</strong> &mdash; the deck defines the key term precisely: <strong>&ldquo;elastic computing&rdquo; refers to the ability to dynamically and on-demand acquire computing resources and support a variable workload</strong>.</li>
<li><strong>Metering</strong> &mdash; <strong>resources are metered and users are charged accordingly</strong>.</li>
<li><strong>Cost-effectiveness from resource multiplexing</strong> &mdash; <strong>lower costs for the cloud service provider are passed to the cloud users</strong>.</li>
</ul>
<div class="concept-box key">
<h4>Scalability versus elasticity &mdash; the distinction students lose</h4>
<p>The deck flags this in its own speaker notes, because it is the most examinable pair of words in the unit. <strong>Scalability is the ability of the system to handle growth</strong> &mdash; the capacity is there, or can be added, to meet a larger load. <strong>Elasticity is the ability to acquire resources dynamically and on demand for a variable workload, and to release them again</strong>. A system can be scalable without being elastic (you add servers by hand and keep them), and the cloud's distinguishing property is elasticity: resources are acquired and released automatically, and you are billed for what you actually used. Elasticity is what makes <strong>workloads with very large peak-to-average ratios</strong> economic &mdash; the phrase the deck uses in its advantages list.</p>
</div>

<h3>5.2.2 Two more characteristics the deck names</h3>
<table class="comparison-table">
<thead>
<tr><th>Characteristic</th><th>What the deck says</th></tr>
</thead>
<tbody>
<tr><td><strong>Data storage</strong></td><td>Data is stored <strong>in the cloud, in certain cases closer to the site where it is used</strong>, and <strong>appears to the users as if stored in a location-independent manner</strong>. The storage strategy can <strong>increase reliability as well as security, and lower communication costs</strong>. Note the vocabulary: this is <em>location transparency</em> from Unit 1, applied to data.</td></tr>
<tr><td><strong>Management</strong></td><td><strong>The maintenance and security are operated by service providers</strong>, who <strong>can operate more efficiently due to specialisation and centralisation</strong>. This is the characteristic that produces the "no administrative or management hassles" advantage &mdash; and the objection in Unit 8, where relinquishing control becomes a security question.</td></tr>
</tbody>
</table>

<p>Both are easy to skim and both are where the unit's later arguments come from. <em>Data storage</em> is the deck's version of Unit 1's location transparency: a user of cloud storage cannot tell where the bytes are, and the provider places them where they are cheapest or closest to use, which is how a cloud claims better reliability and lower communication cost than a machine under a desk. It is also why Unit 8's security question is about <strong>who else can reach that data</strong> rather than about which building holds it. <em>Management</em> is the commercial half: because maintenance and security become the provider's job, the tenant's own administrative burden disappears. Keep the objection next to the advantage, because an examiner will: the centralisation that makes a provider efficient is exactly what makes one outage, or one bad policy, affect every tenant at the same time.</p>
<h3>5.2.3 The benefits &mdash; the Group B, question 10 answer</h3>
<p>The deck gives the advantages of cloud computing in two slides, and they are the content of the 4-mark answer. They group naturally into four families:</p>
<table class="comparison-table">
<thead>
<tr><th>Family</th><th>Benefit</th><th>The deck's wording and reasoning</th></tr>
</thead>
<tbody>
<tr><td rowspan="3"><strong>Efficiency through sharing</strong></td><td>Shared resources</td><td><strong>CPU cycles, storage and network bandwidth are shared.</strong></td></tr>
<tr><td>Higher utilisation through multiplexing</td><td><strong>When multiple applications share a system, their peak demands for resources are not synchronised; thus multiplexing leads to higher resource utilisation.</strong> This is the technical reason the economics work &mdash; the provider sells the same hardware many times over because nobody's peak coincides.</td></tr>
<tr><td>Aggregation for data-intensive work</td><td><strong>Resources can be aggregated to support data-intensive applications</strong>, and <strong>data sharing facilitates collaborative activities</strong> &mdash; many applications need multiple types of analysis of shared data sets and multiple decisions made by groups scattered around the globe.</td></tr>
<tr><td rowspan="2"><strong>Cost</strong></td><td>No capital investment</td><td><strong>It eliminates the initial investment costs for a private computing infrastructure, and the maintenance and operation costs.</strong></td></tr>
<tr><td>Pay-as-you-go</td><td><strong>Cost reduction: the concentration of resources creates the opportunity to pay as you go for computing.</strong></td></tr>
<tr><td rowspan="2"><strong>Capability</strong></td><td>Elasticity</td><td><strong>The ability to accommodate workloads with very large peak-to-average ratios.</strong></td></tr>
<tr><td>User convenience</td><td><strong>Virtualization allows users to operate in familiar environments rather than in idiosyncratic ones.</strong></td></tr>
</tbody>
</table>

<p><strong>Why cloud computing succeeded where earlier paradigms did not</strong> &mdash; a good closing paragraph, and the deck devotes a slide to it:</p>
<ul>
<li><strong>Technology timing</strong> &mdash; it is <strong>in a better position to exploit recent advances in software, networking, storage and processor technologies</strong>, promoted by the same companies that provide the services.</li>
<li><strong>Economics</strong> &mdash; it is used for enterprise computing, and <strong>its adoption by industrial organisations, financial institutions, government and so on has a huge impact on the economy</strong>.</li>
<li><strong>Infrastructure management</strong> &mdash; <strong>a single cloud consists of a mostly homogeneous (now more heterogeneous) set of hardware and software resources, and the resources are in a single administrative domain</strong>. That last point is the technical one: <strong>security, resource management, fault tolerance and quality of service are less challenging than in a heterogeneous environment with resources in multiple administrative domains</strong>.</li>
</ul>
<div class="concept-box tip">
<h4>The advantage/limitation panel from the deck's slide 32</h4>
<p>The deck ends its advantages section with a two-column panel, and it is useful because it pairs each benefit with the cost that pays for it: <strong>advantages</strong> &mdash; no cost of infrastructure, minimum management and cost, no administrative or management hassles, easy accessibility, pay per use, reliability, data control (by the provider), data backup and recovery, huge cloud storage. <strong>Drawbacks</strong> &mdash; a good internet connection and bandwidth required, downtimes, <strong>loss of control</strong>, restricted or limited flexibility, <strong>ongoing costs</strong>, security, <strong>vendor lock-in</strong>, technical issues. Vendor lock-in and loss of control are the two that reappear in Unit 8 as <em>diversity of services</em> and <em>data confidentiality</em>, and in the de-perimeterisation discussion at the end of this chapter.</p>
</div>
<!-- dcc-fig:ch5/ch-5-int-to-cloudcomputing-s32-166.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ch-5-int-to-cloudcomputing-s32-166.webp" alt="Diagram from Ch_5_Int_to_CloudComputing.ppt, slide 32" width="964" height="830" loading="lazy" decoding="async">
<figcaption><strong>slide 32</strong> &middot; Ch_5_Int_to_CloudComputing.ppt</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>5.2.4 Challenges &mdash; brief here, examined in Unit 8</h3>
<p>The deck lists the challenges with the advantages, and they are worth one line each because Unit 8 returns to them:</p>
<table class="comparison-table">
<thead>
<tr><th>Challenge</th><th>The deck's statement</th></tr>
</thead>
<tbody>
<tr><td><strong>Availability of service</strong></td><td><strong>What happens when the service provider cannot deliver?</strong></td></tr>
<tr><td><strong>Data confidentiality and auditability</strong></td><td>Described as <strong>a serious problem</strong>.</td></tr>
<tr><td><strong>Vendor lock-in</strong></td><td><strong>Diversity of services, data organisation and user interfaces at different providers limits user mobility: once a customer is hooked to one provider it is hard to move to another.</strong></td></tr>
<tr><td><strong>Data transfer bottleneck</strong></td><td><strong>Many applications are data-intensive</strong>, so moving the data is itself the cost.</td></tr>
<tr><td><strong>Performance unpredictability</strong></td><td><strong>One of the consequences of resource sharing.</strong> The questions it raises: <strong>how to use resource virtualization and performance isolation for QoS guarantees, and how to support elasticity &mdash; the ability to scale up and down quickly.</strong></td></tr>
<tr><td><strong>Resource management</strong></td><td><strong>It is a big challenge to manage different workloads running on large data centres</strong> &mdash; with self-organisation and self-management offered as the possible answer. This is Unit 6's 6.4.</td></tr>
<tr><td><strong>Security and confidentiality</strong></td><td><strong>A major concern for sensitive applications, for example healthcare.</strong></td></tr>
</tbody>
</table>

<h2>5.3 Cloud service (delivery) models</h2>

<p>The three service models are a stack, ordered by level: <strong>Software as a Service (high level), Platform as a Service, Infrastructure as a Service (low level)</strong>. The cleanest way to explain them is by the layers in the figure below, and the examinable difference between them is <strong>which layer the customer controls and which the provider does</strong>.</p>

<figure class="figure-wide figure-wrap">
<svg class="figure wide" viewBox="0 0 780 420" role="img" aria-label="Cloud service model stack from top to bottom: cloud clients, then Software as a Service supplying applications, Platform as a Service supplying runtime and middleware, and Infrastructure as a Service supplying virtualization, servers, storage and networking; each model bounds the part the customer manages">
<defs><marker id="f5b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="flow-arrow-head"/></marker></defs>

<rect class="flow-box phase4" x="40" y="34" width="700" height="46" rx="9"/>
<text class="flow-text" x="390" y="62">Cloud clients &mdash; web browser, mobile app, thin client, terminal emulator</text>

<rect class="flow-box phase1" x="40" y="104" width="700" height="70" rx="9"/>
<text class="flow-text" x="390" y="132">Software as a Service &mdash; applications</text>
<text class="flow-label" x="390" y="156" text-anchor="middle">CRM, email, virtual desktop, communication, games &mdash; supplied by the provider</text>

<rect class="flow-box phase2" x="40" y="198" width="700" height="70" rx="9"/>
<text class="flow-text" x="390" y="226">Platform as a Service &mdash; runtime and middleware</text>
<text class="flow-label" x="390" y="250" text-anchor="middle">execution runtime, database, web server, development tools</text>

<rect class="flow-box phase3" x="40" y="292" width="700" height="94" rx="9"/>
<text class="flow-text" x="390" y="320">Infrastructure as a Service &mdash; the infrastructure</text>
<text class="flow-label" x="390" y="344" text-anchor="middle">virtual machines, servers, storage, load balancers, network</text>
<text class="flow-label" x="390" y="368" text-anchor="middle">(behind it: virtualization, servers, storage and networking &mdash; the layers the customer never sees)</text>

<text class="flow-label" x="390" y="410" text-anchor="middle">Moving down the stack, the customer manages more and the provider less.</text>
</svg>
<figcaption><strong>Fig 5.2 &mdash; The three delivery models as a stack</strong>, following the deck's slides 22 and 26. The layer names are the ones the deck uses, and the client row at the top is part of its diagram because the model is defined by what reaches the user.</figcaption>
</figure>
<!-- dcc-fig:ch5/ch-5-int-to-cloudcomputing-s22-164.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ch-5-int-to-cloudcomputing-s22-164.webp" alt="Cloud Delivery/Service Models" width="348" height="322" loading="lazy" decoding="async">
<figcaption><strong>slide 22</strong> &middot; Ch_5_Int_to_CloudComputing.ppt &mdash; Cloud Delivery/Service Models</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch5/ref-cloudcomptng-s11-119.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s11-119.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 11" width="560" height="465" loading="lazy" decoding="async">
<figcaption><strong>slide 11</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<table class="comparison-table">
<thead>
<tr><th></th><th>IaaS (low level)</th><th>PaaS</th><th>SaaS (high level)</th></tr>
</thead>
<tbody>
<tr><td><strong>What the provider gives you</strong></td><td><strong>Infrastructure</strong>: compute resources, CPU, VMs, storage.</td><td>A <strong>platform</strong>: the ability to deploy consumer-created or acquired applications <strong>using programming languages and tools supported by the provider</strong>.</td><td><strong>Applications supplied by the service provider.</strong></td></tr>
<tr><td><strong>What the customer controls</strong></td><td><strong>Can deploy and run arbitrary software, including operating systems and applications.</strong> Does not manage or control the underlying cloud infrastructure, but <strong>has control over operating systems, storage, deployed applications, and possibly limited control of some networking components such as host firewalls</strong>.</td><td><strong>Has control over the deployed applications and possibly application hosting environment configurations.</strong> Does <strong>not</strong> manage or control the underlying cloud infrastructure, including network, servers, operating systems or storage.</td><td><strong>Does not manage or control the underlying cloud infrastructure or individual application capabilities.</strong></td></tr>
<tr><td><strong>Services offered</strong></td><td><strong>Server hosting, storage, computing hardware, operating systems, virtual instances, load balancing, Internet access, bandwidth provisioning.</strong></td><td>The runtime, database, web server and development tools the application is built on.</td><td>Enterprise services such as <strong>workflow management, communications, digital signature, customer relationship management (CRM), desktop software, financial management, geo-spatial and search</strong>.</td></tr>
<tr><td><strong>Examples</strong></td><td><strong>Amazon EC2</strong></td><td><strong>Google App Engine, Windows Azure</strong></td><td><strong>Gmail, Salesforce</strong></td></tr>
<tr><td><strong>Not a good fit when</strong></td><td>&mdash;</td><td><strong>The application must be portable</strong>; <strong>proprietary programming languages are used</strong>; or <strong>the hardware and software must be customised to improve the performance of the application</strong>.</td><td><strong>Real-time applications</strong>, or those <strong>where data is not allowed to be hosted externally</strong>.</td></tr>
</tbody>
</table>
<div class="concept-box key">
<h4>Group A, question 2 answered in two sentences</h4>
<p><strong>IaaS provides the infrastructure itself &mdash; virtual machines, servers, storage, load balancers and network &mdash; so the customer controls the operating systems, storage and deployed applications, and can run arbitrary software; Amazon EC2 is the example. PaaS provides a hosted platform of runtime, database, web server and development tools, so the customer controls only the deployed application and its configuration and never the servers, operating systems or storage; Google App Engine and Windows Azure are the examples.</strong> The one-line version: <em>IaaS rents you the machine, PaaS rents you the runtime, SaaS rents you the application.</em> Add that PaaS is a poor fit when the application must be portable or must run on customised hardware &mdash; that sentence is what makes it a comparison rather than two definitions.</p>
</div>
<!-- dcc-fig:ch5/ref-cloudcomptng-s52-124.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s52-124.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 52" width="1280" height="424" loading="lazy" decoding="async">
<figcaption><strong>slide 52</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>5.3.1 Cloud activities &mdash; what a provider actually operates</h3>
<p>The deck lists the activities a cloud service involves, and they are a useful "and what does the provider do all day" paragraph:</p>
<ul>
<li><strong>Service management and provisioning</strong>: virtualization, service provisioning, call centre, operations management, systems management, <strong>QoS management</strong>, <strong>billing and accounting</strong>, asset management, <strong>SLA management</strong>, technical support and backups.</li>
<li><strong>Security management</strong>: identity and authentication, certification and accreditation, intrusion prevention, intrusion detection, virus protection, cryptography, physical security, incident response, access control, audit and trails, firewalls.</li>
<li><strong>Customer services</strong>: customer assistance and online help, subscriptions, business intelligence, reporting, customer preferences, personalisation.</li>
<li><strong>Integration services</strong>: data management and development.</li>
</ul>
<p><strong>SLA management</strong> and <strong>billing and accounting</strong> from the first list are the two that become examinable topics in Unit 8 (8.3), and <strong>identity and authentication</strong> in the second is 8.2's IAM.</p>

<p>Read the four lists as a map of the jobs a provider has to staff, and notice how much of it is not computing at all. Only <em>service provisioning</em> and <em>integration</em> are about running workloads; everything else is the commercial and operational machinery &mdash; billing, SLAs, technical support, subscriptions, reporting, access control and audit. That is the honest answer to "what does it take to be a cloud provider": the virtualized infrastructure of Unit 6 is necessary and nowhere near sufficient, and the parts a customer actually judges the service on are in the middle list.</p>

<h2>5.4 Cloud deployment models</h2>

<h3>5.4.1 What a deployment model is</h3>
<p>Four figures illustrate this section, and they are worth naming before you read them: the <strong>private cloud</strong> diagram with its legitimate access path and its boundary, the <strong>components of a cloud infrastructure</strong> &mdash; servers, storage devices, network, cloud management software and deployment software &mdash; the <strong>infrastructural constraints</strong> page that the reference deck places beside this material, and a research figure showing a <strong>computing node as both data source and data sink</strong> with the task servers it interacts with. Only the first is about a deployment model specifically; the rest are the infrastructure the four models are configurations of, which is why the definition below is stated in terms of <em>who controls it and where it sits</em> rather than what it is built from.</p>
<!-- dcc-fig:ch5/ch-5-int-to-cloudcomputing-s15-162.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ch-5-int-to-cloudcomputing-s15-162.webp" alt="Diagram from Ch_5_Int_to_CloudComputing.ppt, slide 15" width="1210" height="1316" loading="lazy" decoding="async">
<figcaption><strong>slide 15</strong> &middot; Ch_5_Int_to_CloudComputing.ppt</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch5/ref-cloudcomptng-s08-118.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s08-118.webp" alt="Cloud infrastructure consists of servers, storage devices, network, cloud management software, deployment software, and platform virtualization." width="560" height="175" loading="lazy" decoding="async">
<figcaption><strong>slide 8</strong> &middot; Ref_CloudComptng.pptx &mdash; Cloud infrastructure consists of servers, storage devices, network, cloud management software, deployment software, and platform virtualization.</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch5/ref-cloudcomptng-s21-122.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s21-122.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 21" width="468" height="271" loading="lazy" decoding="async">
<figcaption><strong>slide 21</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>The deck gives two definitions and the second is the one to use: <strong>deployment models define the type of access to the cloud, that is, how the cloud is located</strong>. More fully: <strong>a cloud deployment model is a specific configuration of environment parameters such as the accessibility and proprietorship of the deployment infrastructure and storage size &mdash; which means deployment types vary depending on who controls the infrastructure and where it is located.</strong> A cloud can have any of four types of access: <strong>Public, Private, Hybrid and Community</strong>.</p>
<!-- dcc-fig:ch5/ref-cloudcomptng-s39-123.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s39-123.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 39" width="809" height="518" loading="lazy" decoding="async">
<figcaption><strong>slide 39</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>Notice that the definition is about <strong>configuration</strong> rather than technology: what separates the four models is not the hardware but <em>who controls the infrastructure and where it sits relative to the user</em> &mdash; the proprietorship and the accessibility. That is why the same physical data centre can be a public cloud for one customer and a private cloud for another, and why the comparison in 5.4.3 rates the four on security, control and cost rather than on capability: in each row they differ by <em>whose</em> system it is, not by what it can do. The infrastructural constraints the reference deck shows beside this material &mdash; transparency, security, scalability and intelligent monitoring &mdash; are the properties any cloud infrastructure has to hold, whichever of the four it implements.</p>
<!-- dcc-fig:ch5/ref-cloudcomptng-s12-120.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s12-120.webp" alt="Infrastructural Constraints: 	Fundamental constraints that cloud infrastructure should implement are shown in the following diagram:" width="400" height="264" loading="lazy" decoding="async">
<figcaption><strong>slide 12</strong> &middot; Ref_CloudComptng.pptx &mdash; Infrastructural Constraints: 	Fundamental constraints that cloud infrastructure should implement are shown in the following diagram:</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>5.4.2 The four models</h3>

<table class="comparison-table">
<thead>
<tr><th>Model</th><th>Definition</th><th>Ownership and control</th></tr>
</thead>
<tbody>
<tr><td><strong>Public cloud</strong></td><td><strong>The infrastructure is made available to the general public or a large industry group and is owned by the organisation selling cloud services.</strong></td><td>Services are provided on a network for public use; <strong>customers have no control over the location of the infrastructure</strong>. It is based on a <strong>shared cost model for all users</strong>, or a licensing policy such as pay per user.</td></tr>
<tr><td><strong>Private cloud</strong></td><td><strong>The infrastructure is operated solely for an organisation.</strong> Technically there is little to no difference from a public model &mdash; the architectures are very similar &mdash; but only one specific company owns it, which is why it is also called an <strong>internal or corporate</strong> model.</td><td><strong>The server can be hosted externally or on the premises of the owner company.</strong> Regardless of physical location, these infrastructures are <strong>maintained on a designated private network and use software and hardware intended only for the owner company</strong>. <strong>A clearly defined scope of people has access</strong>, which prevents the general public from using it.</td></tr>
<tr><td><strong>Community cloud</strong></td><td><strong>The infrastructure is shared by several organisations and supports a community that has shared concerns.</strong> It largely resembles the private model &mdash; the only difference is the set of users: instead of one company, <strong>several organisations with similar backgrounds share the infrastructure and related resources</strong>.</td><td>A <strong>mutually shared model between organisations belonging to a particular community</strong> &mdash; banks, government organisations or commercial enterprises &mdash; which <strong>generally share similar issues of privacy, performance and security</strong>. It is <strong>managed and hosted internally or by a third-party vendor</strong>.</td></tr>
<tr><td><strong>Hybrid cloud</strong></td><td><strong>A composition of two or more clouds (public, private or community) as unique entities but bound by standardised technology that enables data and application portability.</strong></td><td>It <strong>allows companies to mix and match the facets of the three types that best suit their requirements</strong> &mdash; for example, <strong>balancing load by locating mission-critical workloads on a secure private cloud and deploying less sensitive ones to a public one</strong>.</td></tr>
</tbody>
</table>

<h3>5.4.3 The comparison table &mdash; the core of the Group C answer</h3>
<p>This is the deck's own comparison (slide 21), and it is the single most valuable table in the unit for the 8-mark question. Reproduce it and then add the use cases from 5.4.4.</p>

<table class="comparison-table">
<thead>
<tr><th></th><th>Public</th><th>Private</th><th>Community</th><th>Hybrid</th></tr>
</thead>
<tbody>
<tr><td><strong>Ease of setup and use</strong></td><td><strong>Easy</strong></td><td>Requires IT proficiency</td><td>Requires IT proficiency</td><td>Requires IT proficiency</td></tr>
<tr><td><strong>Data security and privacy</strong></td><td><strong>Low</strong></td><td><strong>High</strong></td><td>Comparatively high</td><td><strong>High</strong></td></tr>
<tr><td><strong>Data control</strong></td><td><strong>Little to none</strong></td><td><strong>High</strong></td><td>Comparatively high</td><td>Comparatively high</td></tr>
<tr><td><strong>Reliability</strong></td><td><strong>Low</strong></td><td><strong>High</strong></td><td>Comparatively high</td><td><strong>High</strong></td></tr>
<tr><td><strong>Scalability and flexibility</strong></td><td><strong>High</strong></td><td><strong>High</strong></td><td><strong>Fixed capacity</strong></td><td><strong>High</strong></td></tr>
<tr><td><strong>Cost-effectiveness</strong></td><td><strong>The cheapest</strong></td><td><strong>Cost-intensive; the most expensive model</strong></td><td><strong>Cost is shared among community members</strong></td><td><strong>Cheaper than a private model but more costly than a public one</strong></td></tr>
<tr><td><strong>Demand for in-house hardware</strong></td><td><strong>No</strong></td><td>Depends</td><td>Depends</td><td>Depends</td></tr>
</tbody>
</table>

<p>Read the table down a column rather than across a row, because the four models are four settings of one trade: <strong>control against convenience</strong>. The public cloud is cheapest and easiest to start with and gives up security, control and reliability. The private cloud is the opposite in every one of those rows and pays for it in cost. The hybrid is the attempt to buy the elastic part cheaply from a public cloud while keeping the sensitive part in-house, which is why it lands between the two on cost and above the public model on control. The community cloud is the one row that is not "high" &mdash; <em>fixed capacity</em> &mdash; because its resources are pooled for a defined group rather than offered elastically to the world. When a question asks which model to recommend, the marks are for naming the trade rather than for picking a winner.</p>

<h3>5.4.4 Advantages, disadvantages and use cases for each</h3>
<p>The Group C question explicitly asks for <strong>suitable use cases</strong>, so the ends of these rows are the marks.</p>

<table class="comparison-table">
<thead>
<tr><th>Model</th><th>Advantages (from the deck)</th><th>Disadvantages (from the deck)</th><th>Suitable use case</th></tr>
</thead>
<tbody>
<tr><td><strong>Public</strong></td><td><strong>Hassle-free infrastructure management</strong> (a third party runs it; no software to develop and maintain, and setup and use are uncomplicated); <strong>high scalability</strong> (extend capacity as requirements increase); <strong>reduced costs</strong> (pay only for the service used, no hardware or software investment); <strong>24/7 uptime</strong> from the provider's server network.</td><td><strong>Compromised reliability</strong> &mdash; the same network meant to ensure against failure still experiences outages and malfunction, citing the 2016 Salesforce CRM disruption that caused a storage collapse. <strong>Data security and privacy issues</strong> &mdash; access is easy, but users are <strong>deprived of knowing where their information is kept and who has access to it</strong>. <strong>Lack of a bespoke service</strong> &mdash; providers have only standardised service options, so complex requirements go unsatisfied.</td><td><strong>Organisations with growing and fluctuating demands</strong>, and businesses of all sizes using it for <strong>web applications, webmail and storage of non-sensitive data</strong>. The deck calls it <strong>the first choice for businesses with low privacy concerns</strong>, and lists <strong>Amazon EC2, Microsoft Azure, Google App Engine, IBM Cloud and Salesforce Heroku</strong> as examples.</td></tr>
<tr><td><strong>Private</strong></td><td>All its benefits <strong>result from its autonomy</strong>: <strong>bespoke and flexible development and high scalability</strong>, letting a company customise its infrastructure to its requirements; and <strong>high security, privacy and reliability</strong>, since <strong>only authorised persons can access resources</strong>.</td><td><strong>Cost</strong> &mdash; considerable expense on hardware, software and staff training, which is why it is <strong>not the right choice for small companies</strong>.</td><td><strong>Companies that seek to safeguard their mission-critical operations</strong>, and businesses with <strong>constantly changing requirements</strong> where customisation matters. Because of recent breaches, <strong>a growing number of large corporations has decided on a closed private cloud model to minimise data security issues</strong>. Examples: <strong>Amazon, IBM, Cisco, Dell and Red Hat</strong> also provide private solutions.</td></tr>
<tr><td><strong>Community</strong></td><td><strong>Cost reduction</strong> (shared by all members); <strong>improved security, privacy and reliability</strong>; <strong>ease of data sharing and collaboration</strong>. Where <strong>all participating organisations have uniform security, privacy and performance requirements, this multi-tenant data-centre architecture helps them enhance efficiency</strong>, and <strong>a centralised cloud facilitates project development, management and implementation</strong>.</td><td><strong>High cost compared to the public deployment model</strong>, and <strong>sharing of fixed storage and bandwidth capacity</strong> &mdash; which is exactly the "fixed capacity" row in 5.4.3.</td><td><strong>Joint projects between organisations with a shared concern</strong>: <strong>banks</strong> with the same regulatory obligations, <strong>government organisations</strong>, universities or commercial enterprises &mdash; the deck's examples of a community are exactly these three.</td></tr>
<tr><td><strong>Hybrid</strong></td><td><strong>Improved security and privacy</strong> (sensitive workloads stay private), <strong>enhanced scalability and flexibility</strong> (burst into the public cloud), and a <strong>reasonable price</strong>; it also <strong>facilitates data and application portability</strong>, which is the condition for calling it hybrid at all.</td><td>Because it <strong>encompasses the other three models</strong>, it inherits their management overheads, and it requires <strong>standardised technology that enables data and application portability</strong> &mdash; with the deck's other models' drawbacks (IT proficiency, ongoing costs, vendor lock-in) still applying to the parts.</td><td><strong>A company balancing load by locating mission-critical workloads on a secure private cloud and deploying less sensitive ones to a public one</strong> &mdash; which <strong>safeguards and controls strategically important assets in a cost- and resource-effective way</strong>. In practice: a bank keeping customer records private while serving its public website from a public cloud; a retailer that runs on private infrastructure and bursts to public capacity for festive demand.</td></tr>
</tbody>
</table>

<div class="concept-box tip">
<h4>How to write the 8-mark answer</h4>
<p>Five short moves, in this order: <strong>(1)</strong> define a deployment model as the configuration of accessibility and proprietorship &mdash; who controls the infrastructure and where it is located. <strong>(2)</strong> Give the four definitions in two lines each (5.4.2). <strong>(3)</strong> Draw the comparison table (5.4.3) &mdash; this <em>is</em> the "compare" half, and seven rows carry seven comparisons. <strong>(4)</strong> Give one advantage and one disadvantage per model (5.4.4) &mdash; this is the "contrast" half. <strong>(5)</strong> Give a use case per model, naming the kind of organisation rather than a product: fluctuating public web workload; mission-critical operations under one company's control; joint bank or government project; private core with public burst. Three of the four models must be named from the syllabus wording &mdash; Public, Private, Hybrid, Community &mdash; and the fourth, <em>Federated</em>, may be mentioned as a related type.</p>
</div>

<h3>5.4.5 Ethical issues and de-perimeterisation</h3>
<p>The deck closes the unit with the consequences of moving to the cloud, and these two paragraphs are unusually good material for a "critically discuss" question.</p>

<p><strong>The paradigm shift and its ethical implications:</strong> <strong>control is relinquished to third-party services</strong>; <strong>data is stored on multiple sites administered by several organisations</strong>; and <strong>multiple services interoperate across the network</strong>. The implications are <strong>unauthorized access, data corruption, and infrastructure failure and service unavailability</strong>.</p>

<p><strong>De-perimeterisation.</strong> <strong>Systems can span the boundaries of multiple organisations and cross security borders.</strong> Because <strong>the complex structure of cloud services can make it difficult to determine who is responsible when something undesirable happens</strong>, and because <strong>identity fraud and theft are made possible by unauthorised access to personal data in circulation and by new forms of dissemination through social networks</strong>, the traditional network boundary stops being the place where security is enforced. The deck's own definition: <strong>de-perimeterisation is the removal of a boundary between an organisation and the outside world &mdash; protecting systems and data on multiple levels using a mixture of encryption, secure protocols, secure systems and data-level authentication, rather than relying on the network boundary to the Internet.</strong> Successful de-perimeterisation means the outer security boundary <em>was removed</em>. This is the bridge into Unit 8: once the perimeter is gone, identity and access management (8.2) and data-level security (8.1) are the only controls left.</p>
<!-- dcc-fig:ch5/ch-5-int-to-cloudcomputing-s18-163.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ch-5-int-to-cloudcomputing-s18-163.webp" alt="Diagram from Ch_5_Int_to_CloudComputing.ppt, slide 18" width="1210" height="1303" loading="lazy" decoding="async">
<figcaption><strong>slide 18</strong> &middot; Ch_5_Int_to_CloudComputing.ppt</figcaption>
</figure>
<!-- /dcc-fig -->
<div class="concept-box tip">
<h4>The paper-facing part of this unit</h4>
<p>Everything in this unit that is written to be answered in the exam &mdash; what each question asks for, and the model answer to it &mdash; is collected in <a href="#/ch/5/past">Past Questions</a>. Read this tab for the subject; switch to that one when you sit down to answer a question.</p>
</div>
`,

  pastSummary: `<h2>Exam-facing summary</h2>
<table class="comparison-table">
<thead>
<tr><th>If the question says&hellip;</th><th>Give&hellip;</th></tr>
</thead>
<tbody>
<tr><td>Define cloud computing</td><td>The Wikipedia definition (ubiquitous access to shared pools of configurable resources, rapidly provisioned with minimal management effort, economies of scale like a public utility) and the Azure one (delivery of computing services over the Internet, charged by usage like gas or electricity).</td></tr>
<tr><td>Trace the history and evolution</td><td>Renting computing from the 1950s; grid computing (National Labs, early 1990s, scientific, non-interactive workloads) and utility computing (2005&ndash;06, IT companies, enterprise, charged for specific usage rather than a flat rate); the five technologies &mdash; distributed systems and peripherals, virtualization, Web 2.0, service orientation, utility computing; and Fig 5.1 with cloud computing in 2007.</td></tr>
<tr><td>What are the characteristics of cloud computing?</td><td>On-demand, scalable and elastic; resources metered with charging only for what is used; a shared pool of resources; Internet technology for scalable and elastic services; elasticity defined as dynamically and on-demand acquiring resources for a variable workload; cost-effectiveness through resource multiplexing; location-independent data storage; management by the provider through specialisation and centralisation.</td></tr>
<tr><td>Key features and benefits (4 marks)</td><td>Shared CPU, storage and bandwidth; higher utilisation because peaks are unsynchronised; aggregation for data-intensive applications and collaboration on shared data sets; no initial infrastructure investment and no maintenance or operation costs; pay-as-you-go; elasticity for large peak-to-average ratios; user convenience through virtualization. Close with why it succeeded: technology timing, economics, and a single administrative domain.</td></tr>
<tr><td>Differentiate IaaS and PaaS (2 marks)</td><td>The two sentences in the tip box above, plus "IaaS rents the machine, PaaS rents the runtime, SaaS rents the application", with EC2 and Google App Engine/Windows Azure.</td></tr>
<tr><td>Compare the four deployment models (8 marks)</td><td>The five moves in the 5.4.4 tip: definition of a deployment model, the four definitions, the 7&times;4 comparison table, advantages and disadvantages, one use case each.</td></tr>
<tr><td>What challenges does cloud computing face?</td><td>Availability of service, data confidentiality and auditability, diversity of services and vendor lock-in, data transfer bottleneck, performance unpredictability from resource sharing (with virtualization, performance isolation and QoS, and elasticity as the questions), resource management, and security for sensitive applications such as healthcare.</td></tr>
<tr><td>Discuss ethical issues in cloud computing</td><td>Control relinquished to third parties, data on multiple sites under several organisations, services interoperating across the network &mdash; with the implications of unauthorized access, data corruption and service unavailability; then de-perimeterisation and its replacement controls.</td></tr>
</tbody>
</table>


`,

  quiz: [
    {
      q: 'Which two early computing models preceded cloud computing?',
      options: [
        'Grid computing (scientific, National Labs, early 1990s) and utility computing (enterprise, IT companies, 2005-2006)',
        'Mainframe computing and thin-client computing',
        'Serverless computing and container computing',
        'Peer-to-peer computing and grid computing only'
      ],
      answer: 0,
      explanation: 'Grid computing was initiated by the National Labs in the early 1990s and targeted scientific computing with non-interactive workloads; utility computing was initiated in 2005-2006 by IT companies for enterprise computing and charges for specific usage rather than a flat rate. The deck credits five technologies with making cloud computing possible: distributed systems and their peripherals, virtualization, Web 2.0, service orientation and utility computing.'
    },
    {
      q: 'Which of these is a defining attribute of cloud computing, as listed in the deck\'s model map?',
      options: [
        'Manual provisioning by the customer',
        'Utility computing with pay-per-usage, accessible via the Internet, with elasticity',
        'Fixed, contract-locked capacity',
        'On-premises hardware ownership'
      ],
      answer: 1,
      explanation: 'The deck\'s map has three rows: delivery models (SaaS, PaaS, IaaS), deployment models (public, private, community, hybrid) and defining attributes — utility computing / pay-per-usage, accessible via the Internet, and elasticity.'
    },
    {
      q: 'What is the difference between scalability and elasticity?',
      options: [
        'They are the same thing',
        'Scalability is the ability to handle growth; elasticity is dynamically and on-demand acquiring resources to support a variable workload',
        'Scalability applies to storage only and elasticity to compute only',
        'Elasticity means the cost is fixed and scalability means it is variable'
      ],
      answer: 1,
      explanation: 'The deck flags this as a distinction to teach. Elastic computing refers to the ability to dynamically and on-demand acquire computing resources and support a variable workload — which is what makes workloads with large peak-to-average ratios economic, because resources can also be released.'
    },
    {
      q: 'Why does resource multiplexing make cloud computing cheaper, according to the deck?',
      options: [
        'Because hardware is bought in bulk at a discount',
        'Because when multiple applications share a system their peak demands are not synchronised, so utilisation is higher',
        'Because users are charged a flat rate regardless of use',
        'Because the provider uses older hardware'
      ],
      answer: 1,
      explanation: 'The deck\'s sentence: when multiple applications share a system, their peak demands for resources are not synchronised, so multiplexing leads to higher resource utilisation. Lower costs for the provider are then passed to the users.'
    },
    {
      q: 'A single cloud consists of mostly homogeneous resources in a single administrative domain. Why does the deck give this as a reason for its success?',
      options: [
        'Because homogeneous hardware is faster',
        'Because security, resource management, fault tolerance and quality of service are less challenging than in a heterogeneous environment with resources in multiple administrative domains',
        'Because it prevents vendor lock-in',
        'Because it removes the need for virtualization'
      ],
      answer: 1,
      explanation: 'That is the infrastructures-management reason, alongside the technology-timing reason (exploiting advances in software, networking, storage and processors) and the economic one (adoption by industry, finance and government).'
    },
    {
      q: 'In which service model does the customer control the operating systems, storage and deployed applications?',
      options: [
        'SaaS',
        'PaaS',
        'IaaS',
        'None — the provider controls all of them in every model'
      ],
      answer: 2,
      explanation: 'IaaS lets the user deploy and run arbitrary software, including operating systems and applications. The user does not manage the underlying cloud infrastructure but controls operating systems, storage, deployed applications and possibly limited networking components such as host firewalls. Amazon EC2 is the example.'
    },
    {
      q: 'A PaaS deployment is NOT particularly useful when:',
      options: [
        'The application is a web application',
        'The application must be portable, proprietary programming languages are used, or hardware and software must be customised for performance',
        'The application uses a database',
        'The team is small'
      ],
      answer: 1,
      explanation: 'Those three are the deck\'s stated conditions. PaaS gives the customer control over the deployed application and possibly application hosting environment configurations, but not the network, servers, operating systems or storage — which is exactly what portability and customisation require.'
    },
    {
      q: 'Which pair correctly matches a service model with its example?',
      options: [
        'IaaS — Gmail; SaaS — Amazon EC2',
        'IaaS — Amazon EC2; PaaS — Google App Engine and Windows Azure; SaaS — Gmail and Salesforce',
        'PaaS — Gmail; SaaS — Amazon EC2',
        'IaaS — Salesforce; PaaS — Amazon EC2'
      ],
      answer: 1,
      explanation: 'The deck\'s examples: IaaS — Amazon EC2; PaaS — Google App Engine and Windows Azure; SaaS — Gmail and Salesforce. SaaS supplies applications; the user controls neither the infrastructure nor individual application capabilities, and it suits neither real-time applications nor data that must not be hosted externally.'
    },
    {
      q: 'Which cloud deployment model is owned by the organisation selling the services and made available to the general public?',
      options: [
        'Private cloud',
        'Community cloud',
        'Public cloud',
        'Hybrid cloud'
      ],
      answer: 2,
      explanation: 'The public cloud\'s infrastructure is made available to the general public or a large industry group and owned by the organisation selling cloud services; customers have no control over the location of the infrastructure. It is the first choice for businesses with low privacy concerns.'
    },
    {
      q: 'What is the only difference between a community cloud and a private cloud?',
      options: [
        'The technology used',
        'The set of users — several organisations with similar backgrounds share the infrastructure instead of one company',
        'The deployment location',
        'The billing model'
      ],
      answer: 1,
      explanation: 'A community deployment model largely resembles the private one; the difference is that several organisations with similar backgrounds share the infrastructure and resources. Members generally share similar privacy, performance and security issues, and it is managed internally or by a third-party vendor.'
    },
    {
      q: 'What defines a hybrid cloud?',
      options: [
        'A cloud that uses both physical and virtual servers',
        'A composition of two or more clouds (public, private or community) as unique entities, bound by standardised technology enabling data and application portability',
        'A private cloud with a backup site',
        'Any cloud with more than one tenant'
      ],
      answer: 1,
      explanation: 'The binding condition matters: standardised technology enabling data and application portability. A company can then balance load by putting mission-critical workloads on a secure private cloud and less sensitive ones on a public one, which safeguards strategically important assets cost- and resource-effectively.'
    },
    {
      q: 'According to the deck\'s comparison, which model has "little to none" data control and is the cheapest?',
      options: [
        'Private',
        'Community',
        'Public',
        'Hybrid'
      ],
      answer: 2,
      explanation: 'The comparison table: public has little-to-none data control, low data security and privacy, low reliability, high scalability and flexibility, and is the cheapest, with no demand for in-house hardware. Private is the most expensive and the most secure; community shares cost but has fixed capacity; hybrid is cheaper than private but costlier than public.'
    },
    {
      q: 'Which is a disadvantage of the public cloud that the deck lists?',
      options: [
        'It requires extensive staff training',
        'Users are deprived of knowing where their information is kept and who has access to it',
        'It cannot scale beyond a fixed capacity',
        'It requires in-house hardware'
      ],
      answer: 1,
      explanation: 'The three public-cloud disadvantages are compromised reliability (citing the 2016 Salesforce CRM disruption), data security and privacy concerns — since although access to data is easy, users do not know where their information is kept or who can access it — and the lack of a bespoke service, because providers offer only standardised options.'
    },
    {
      q: 'What is vendor lock-in as the deck describes it?',
      options: [
        'The provider refusing to release your data after payment stops',
        'The diversity of services, data organisation and user interfaces at different providers limiting user mobility, so moving provider is hard',
        'A long-term contract requirement',
        'Proprietary hardware in the data centre'
      ],
      answer: 1,
      explanation: 'It is listed among the challenges: diversity of services, data organisation and user interfaces available at different service providers limits user mobility — once a customer is hooked to one provider, it is hard to move to another.'
    },
    {
      q: 'What does de-perimeterisation mean in the cloud context?',
      options: [
        'Removing the cloud provider\'s firewall',
        'Removing the boundary between an organisation and the outside world, protecting systems and data with encryption, secure protocols and data-level authentication instead of relying on the network boundary',
        'Encrypting only the network traffic',
        'Moving all data back on premises'
      ],
      answer: 1,
      explanation: 'Systems span the boundaries of multiple organisations, and the complex structure of cloud services makes it hard to determine who is responsible when something goes wrong. De-perimeterisation replaces the network perimeter with layered controls at the data level, and successful implementation means the outer security boundary was removed.'
    },
    {
      q: 'In the public cloud, what does the customer pay for?',
      options: [
        'A flat monthly rate regardless of use',
        'Only the resources used, metered by usage',
        'The hardware, amortised over time',
        'Only the software licences'
      ],
      answer: 1,
      explanation: 'Resources are metered and users are charged only for the resources used — the utility analogy the Azure definition makes explicit ("similar to how you are billed for gas or electricity at home"). Separate from that, a public cloud may use a shared cost model for all users or a licensing policy such as pay per user.'
    }
  ],

  past: [
    {
      year: '2025 (expected)',
      marks: '5',
      repeats: 1,
      q: 'Explain the evolution of cloud computing from Mainframe to Cloud.',
      occ: [
        { year: '2025 (expected)', marks: '5', q: 'Explain the evolution of cloud computing from Mainframe to Cloud.' }
      ],
      answer: `
<h4>Model answer &mdash; 5 marks</h4>
<p>The marks are in the sequence and in what each step was fundamentally about:</p>
<ul>
<li><strong>Mainframe (1960s&ndash;70s)</strong> &mdash; one large central machine, dumb terminals,
time-sharing. The computing power is centralised and the client is a screen. The idea of
<em>sharing a pool of computing power among many users</em> starts here.</li>
<li><strong>Client&ndash;server and the PC (1980s)</strong> &mdash; power moves outward. Each user
has a machine, and applications and data sit on servers reached over a LAN. This buys
individual control at the cost of central efficiency.</li>
<li><strong>Grid and cluster computing (1990s)</strong> &mdash; many machines are made to look
like one, first within a cluster, then across institutions in a grid. Job scheduling across
owned resources becomes the problem, and it works but only for batch work between parties who
agree to share.</li>
<li><strong>Utility computing and virtualisation (early 2000s)</strong> &mdash; the question
shifts from <em>can we pool</em> to <em>can we sell it</em>. Virtualisation decouples the
machine from the workload, and a provider can now rent a slice of a machine by the hour.</li>
<li><strong>Cloud (2006 onward)</strong> &mdash; AWS EC2 opens the model to anyone with a card:
elastic, self-service, measured, pay-per-use. The technical capacity already existed by 2000.
What the cloud adds is the commercial and self-service interface on top of it.</li>
</ul>
<div class="concept-box tip">
<h4>Marking this one</h4>
<p>Predicted &mdash; from the previous site's “2025 Exam / Expected” set, 5 marks. Five
stages, five marks, one line each: this is deliberately a breadth question and time spent on
any one stage is time not spent on the others. The line that lifts it is the last one &mdash;
that the cloud's novelty is the interface and the billing, not the hardware.</p>
</div>
`
    },
    {
      year: '2025 (expected)',
      marks: '6',
      repeats: 1,
      q: 'Compare IaaS, PaaS, and SaaS with suitable examples.',
      occ: [
        { year: '2025 (expected)', marks: '6', q: 'Compare IaaS, PaaS, and SaaS with suitable examples.' }
      ],
      answer: `
<h4>Model answer &mdash; 6 marks</h4>
<p>The three service models differ in one thing, and it is the only thing worth leading with:
<strong>how much of the stack the provider manages and how much the customer manages</strong>.
The provider always manages the physical hardware; what moves as you go up is the boundary.</p>
<table class="comparison-table">
<tr><th>Model</th><th>The provider manages</th><th>You manage</th><th>Examples</th></tr>
<tr><td><strong>IaaS</strong></td><td>Virtualisation, servers, storage, networking</td><td>OS, runtime, middleware, applications, data</td><td>AWS EC2, Google Compute Engine, Azure Virtual Machines</td></tr>
<tr><td><strong>PaaS</strong></td><td>IaaS plus OS, runtime and middleware</td><td>Applications and data only</td><td>Google App Engine, Heroku, Azure App Service</td></tr>
<tr><td><strong>SaaS</strong></td><td>Everything, including the application</td><td>Your data and your users' configuration</td><td>Gmail, Google Docs, Salesforce, Microsoft 365</td></tr>
</table>
<p>The consequence to state explicitly, because it is where the marks are: control falls as you
climb and convenience rises. IaaS gives the most control and the most operational work; SaaS
gives the least of both. That is why a company migrating with a legacy operating system it
cannot change chooses IaaS, while one that wants a web application deployed without an
operations team chooses PaaS.</p>
<div class="concept-box tip">
<h4>Marking this one</h4>
<p>Predicted, not a past paper &mdash; from the previous site's “2025 Exam / Expected”
set. Six marks for three models: the table is two thirds of the answer and the sentence about
control moving with convenience is the rest. An answer that describes each model separately
without comparing them answers a different question.</p>
</div>
`
    },
    {
      year: '2025 (expected)',
      marks: '8',
      repeats: 1,
      q: 'Explain the NIST definition of cloud computing and its five essential characteristics.',
      occ: [
        { year: '2025 (expected)', marks: '8', q: 'Explain the NIST definition of cloud computing and its five essential characteristics.' }
      ],
      answer: `
<h4>Model answer &mdash; 8 marks</h4>
<p><strong>The NIST definition.</strong> Cloud computing is a model for enabling ubiquitous,
convenient, on-demand network access to a shared pool of configurable computing resources
(networks, servers, storage, applications and services) that can be rapidly provisioned and
released with minimal management effort or service-provider interaction. Four words in that
sentence carry the marks: <em>on-demand</em>, <em>shared pool</em>, <em>rapidly provisioned</em>
and <em>minimal provider interaction</em>.</p>
<p>The definition is stated as <strong>five essential characteristics</strong>, three service
models and four deployment models. The five:</p>
<ol>
<li><strong>On-demand self-service</strong> &mdash; a consumer provisions computing capability
unilaterally and automatically, without human interaction with the provider. This is the
property that separates a cloud from a hosting company.</li>
<li><strong>Broad network access</strong> &mdash; the capabilities are available over the network
through standard mechanisms, so thin and thick clients alike can reach them.</li>
<li><strong>Resource pooling</strong> &mdash; the provider's resources are pooled to serve
multiple consumers using a <em>multi-tenant</em> model, with physical and virtual resources
assigned and reassigned dynamically. The customer generally has no knowledge of, or control
over, the exact location of the resources.</li>
<li><strong>Rapid elasticity</strong> &mdash; capabilities can be elastically provisioned and
released, so they appear unlimited to the consumer and can be bought up or down at any time.</li>
<li><strong>Measured service</strong> &mdash; resource use is monitored, controlled and reported,
providing transparency for both provider and consumer. This is what makes <em>pay-as-you-go</em>
possible.</li>
</ol>
<div class="concept-box tip">
<h4>Marking this one</h4>
<p>This is a predicted question, not a question from a paper &mdash; it comes from the previous
site's “Teacher Notes / 2025 Expected” set, so treat it as a drill rather than
evidence. It is worth answering anyway, because the five characteristics are the part of the
syllabus that every cloud question is marked against. Five named characteristics with one
sentence each is the structure; the definition itself is the opening mark, and quoting its
distinctive phrases is how you show it is the NIST wording rather than a paraphrase.</p>
</div>
`
    },
    {
      year: 'Model 2025',
      marks: '2',
      repeats: 1,
      q: 'What is the difference between IaaS and PaaS?',
      occ: [
        { year: 'Model 2025', marks: '2', q: 'What is the difference between IaaS and PaaS?' }
      ],
      answer: `
<h4>Model answer &mdash; 2 marks</h4>
<p><strong>IaaS</strong> (Infrastructure as a Service) provides the <strong>infrastructure itself</strong> &mdash; <strong>compute resources, CPU, virtual machines, servers, storage, load balancers and network</strong>. The user <strong>can deploy and run arbitrary software, which can include operating systems and applications</strong>: the user does not manage or control the underlying cloud infrastructure, but <strong>has control over operating systems, storage, deployed applications and possibly limited control of some networking components such as host firewalls</strong>. Services offered include server hosting, storage, computing hardware, operating systems, virtual instances, load balancing, Internet access and bandwidth provisioning. <strong>Example: Amazon EC2.</strong></p>

<p><strong>PaaS</strong> (Platform as a Service) provides a <strong>platform</strong>: it allows a cloud user <strong>to deploy consumer-created or acquired applications using programming languages and tools supported by the service provider</strong>. The user <strong>has control over the deployed applications and possibly application hosting environment configurations, but does not manage or control the underlying cloud infrastructure, including network, servers, operating systems or storage</strong>. It is <strong>not particularly useful when the application must be portable, when proprietary programming languages are used, or when the hardware and software must be customised to improve performance</strong>. <strong>Examples: Google App Engine, Windows Azure.</strong></p>

<p><strong>In one line:</strong> IaaS rents you the <em>machine</em> (you still manage the OS and everything above it); PaaS rents you the <em>runtime and middleware</em> (you manage only the application). Both are below SaaS, which rents you the finished application.</p>

<div class="concept-box tip">
<h4>Where this came from</h4>
<p>Group A, question 2 of the <em>Model Question 2025</em> &mdash; Group A is 2 marks per question, so this is a definition-plus-distinction answer, not an essay. Naming the layer boundary (operating system for IaaS, runtime for PaaS) and one example each is what earns both marks.</p>
</div>`
    },
    {
      year: 'Model 2025',
      marks: '4',
      repeats: 1,
      q: 'What are the key features and benefits of cloud computing?',
      occ: [
        { year: 'Model 2025', marks: '4', q: 'What are the key features and benefits of cloud computing?' }
      ],
      answer: `
<h4>Model answer &mdash; 4 marks</h4>
<p><strong>Key features.</strong> Cloud computing offers <strong>on-demand, scalable and elastic computing and storage services</strong>, with resources that are <strong>metered and charged only for what is used</strong>. Its defining attributes are <strong>utility computing with pay-per-usage, accessibility via the Internet, and elasticity</strong>. Four characteristics make it work:</p>
<ul>
<li><strong>A shared pool of resources</strong> with provider-side resource management.</li>
<li><strong>Internet technology</strong> delivering scalable and elastic services &mdash; where <strong>elastic computing is the ability to dynamically and on-demand acquire computing resources and support a variable workload</strong>.</li>
<li><strong>Metering</strong>, so users are charged according to the resources used.</li>
<li><strong>Cost-effectiveness through resource multiplexing</strong>, with the provider's lower costs passed on to users.</li>
</ul>
<p>Two further characteristics: <strong>data storage is location-independent</strong> &mdash; the data may sit closer to where it is used and appears to users as stored in a location-independent manner, which can increase reliability and security and lower communication costs &mdash; and <strong>maintenance and security are operated by the service providers</strong>, who are more efficient because of specialisation and centralisation.</p>

<p><strong>Benefits.</strong></p>
<ul>
<li><strong>Shared resources</strong> &mdash; CPU cycles, storage and network bandwidth are shared.</li>
<li><strong>Higher resource utilisation</strong> &mdash; when multiple applications share a system, their peak demands are not synchronised, so multiplexing raises utilisation.</li>
<li><strong>Aggregation and collaboration</strong> &mdash; resources can be aggregated to support data-intensive applications, and data sharing facilitates collaborative activities across geographically scattered groups.</li>
<li><strong>No capital investment</strong> &mdash; it eliminates the initial cost of a private infrastructure and its maintenance and operation costs.</li>
<li><strong>Pay-as-you-go cost reduction</strong> &mdash; concentration of resources makes paying for computing by usage possible.</li>
<li><strong>Elasticity</strong> &mdash; the ability to accommodate workloads with very large peak-to-average ratios.</li>
<li><strong>User convenience</strong> &mdash; virtualization lets users work in familiar environments rather than idiosyncratic ones.</li>
</ul>
<p><em>Optional closing line:</em> cloud computing succeeded where earlier paradigms did not because it uses a single administrative domain, making security, resource management, fault tolerance and QoS less challenging than in a heterogeneous environment with resources in multiple administrative domains.</p>

<div class="concept-box tip">
<h4>Where this came from</h4>
<p>Group B, question 10 of the <em>Model Question 2025</em>, worth 4 marks. The question asks for <strong>features and benefits</strong> &mdash; two halves &mdash; so head the answer with two sections. Ten short items beat three long paragraphs here, because the marking scheme is a list.</p>
</div>`
    },
    {
      year: 'Model 2025',
      marks: '8',
      repeats: 1,
      q: 'Compare and contrast the public, private, hybrid, and community cloud deployment models with suitable use cases.',
      occ: [
        { year: 'Model 2025', marks: '8', q: 'Compare and contrast the public, private, hybrid, and community cloud deployment models with suitable use cases.' }
      ],
      answer: `
<h4>Model answer &mdash; 8 marks</h4>

<p><strong>1. What a deployment model is.</strong> A <strong>cloud deployment model is a specific configuration of environment parameters such as the accessibility and proprietorship of the deployment infrastructure and storage size</strong> &mdash; that is, deployment types vary according to <strong>who controls the infrastructure and where it is located</strong>. A cloud can have any of four types of access: <strong>public, private, hybrid and community</strong>.</p>

<p><strong>2. The four models.</strong></p>
<ul>
<li><strong>Public cloud</strong> &mdash; the infrastructure is <strong>made available to the general public or a large industry group and is owned by the organisation selling cloud services</strong>. Customers have <strong>no control over the location of the infrastructure</strong>, and it uses a shared cost model or a licensing policy such as pay per user.</li>
<li><strong>Private cloud</strong> &mdash; the infrastructure is <strong>operated solely for one organisation</strong>. Technically it resembles a public cloud closely; the difference is ownership, which is why it is also called an <strong>internal or corporate</strong> model. The servers may be hosted externally or on the owner's premises, but are <strong>maintained on a designated private network using hardware and software intended only for the owner</strong>, and <strong>a clearly defined set of people has access</strong>.</li>
<li><strong>Community cloud</strong> &mdash; the infrastructure is <strong>shared by several organisations that support a community with shared concerns</strong>. It resembles the private model except in the set of users: <strong>organisations with similar backgrounds share the infrastructure and resources</strong>, generally sharing similar privacy, performance and security issues, and it is managed internally or by a third party.</li>
<li><strong>Hybrid cloud</strong> &mdash; a <strong>composition of two or more clouds (public, private or community) as unique entities, bound by standardised technology that enables data and application portability</strong>. It lets a company mix the facets of the other three that suit it.</li>
</ul>

<p><strong>3. Comparison (the table to reproduce).</strong></p>
<table class="comparison-table">
<thead>
<tr><th></th><th>Public</th><th>Private</th><th>Community</th><th>Hybrid</th></tr>
</thead>
<tbody>
<tr><td>Ease of setup and use</td><td><strong>Easy</strong></td><td>Requires IT proficiency</td><td>Requires IT proficiency</td><td>Requires IT proficiency</td></tr>
<tr><td>Data security and privacy</td><td>Low</td><td><strong>High</strong></td><td>Comparatively high</td><td><strong>High</strong></td></tr>
<tr><td>Data control</td><td>Little to none</td><td><strong>High</strong></td><td>Comparatively high</td><td>Comparatively high</td></tr>
<tr><td>Reliability</td><td>Low</td><td><strong>High</strong></td><td>Comparatively high</td><td><strong>High</strong></td></tr>
<tr><td>Scalability and flexibility</td><td><strong>High</strong></td><td><strong>High</strong></td><td><strong>Fixed capacity</strong></td><td><strong>High</strong></td></tr>
<tr><td>Cost-effectiveness</td><td><strong>Cheapest</strong></td><td><strong>Most expensive</strong></td><td>Cost shared among members</td><td>Cheaper than private, costlier than public</td></tr>
<tr><td>Demand for in-house hardware</td><td>No</td><td>Depends</td><td>Depends</td><td>Depends</td></tr>
</tbody>
</table>

<p><strong>4. Advantages, disadvantages and use cases.</strong></p>
<ul>
<li><strong>Public</strong> &mdash; <em>Advantages:</em> hassle-free infrastructure management, high scalability, reduced costs (pay only for what is used, no hardware or software investment), 24/7 uptime. <em>Disadvantages:</em> compromised reliability (the deck cites the 2016 Salesforce CRM disruption), data security and privacy concerns because <strong>users do not know where their information is kept or who has access</strong>, and the lack of a bespoke service since providers offer only standardised options. <em>Use case:</em> <strong>organisations with growing and fluctuating demands</strong> &mdash; <strong>web applications, webmail and storage of non-sensitive data</strong>; it is <strong>the first choice for businesses with low privacy concerns</strong> (Amazon EC2, Microsoft Azure, Google App Engine, IBM Cloud, Salesforce Heroku).</li>
<li><strong>Private</strong> &mdash; <em>Advantages:</em> all resulting from autonomy &mdash; bespoke and flexible development, high scalability, and <strong>high security, privacy and reliability</strong> since only authorised persons can access resources. <em>Disadvantage:</em> <strong>cost</strong>, requiring considerable expense on hardware, software and staff training, which makes it unsuitable for small companies. <em>Use case:</em> <strong>safeguarding mission-critical operations</strong> and businesses with <strong>constantly changing requirements</strong> that need customisation &mdash; and, as the deck notes, a growing number of large corporations now choose a closed private cloud to minimise data-security issues after recent breaches.</li>
<li><strong>Community</strong> &mdash; <em>Advantages:</em> <strong>cost reduction</strong> (shared by members), <strong>improved security, privacy and reliability</strong>, and <strong>ease of data sharing and collaboration</strong>; where members have uniform security, privacy and performance requirements, this multi-tenant data centre raises efficiency and the centralised cloud eases project development and management. <em>Disadvantages:</em> <strong>high cost compared to the public model</strong> and <strong>sharing of fixed storage and bandwidth capacity</strong>. <em>Use case:</em> <strong>joint projects among organisations with a shared concern</strong> &mdash; <strong>banks</strong>, <strong>government organisations</strong> or commercial enterprises.</li>
<li><strong>Hybrid</strong> &mdash; <em>Advantages:</em> <strong>improved security and privacy</strong>, <strong>enhanced scalability and flexibility</strong>, a <strong>reasonable price</strong>, and <strong>data and application portability</strong>. <em>Disadvantages:</em> it inherits the other models' overheads (IT proficiency, ongoing costs, vendor lock-in) and depends on standardised technology to allow portability. <em>Use case:</em> <strong>balancing load by locating mission-critical workloads on a secure private cloud and deploying less sensitive ones to a public one</strong>, which safeguards strategically important assets cost- and resource-effectively &mdash; for example a bank keeping customer records private while serving its public site from a public cloud.</li>
</ul>

<p><strong>5. Conclusion.</strong> The four models are not ranked; they trade <strong>control, security and cost</strong> against each other. The public cloud is cheapest and easiest but weakest on data control; the private cloud is the opposite; the community cloud shares the cost of a private-style deployment among organisations with a common interest, at the price of fixed capacity; and the hybrid cloud exists to place each workload where its requirements are best met.</p>

<div class="concept-box tip">
<h4>Where this came from</h4>
<p>Group C, question 13 of the <em>Model Question 2025</em>, worth 8 marks. The question says <strong>compare and contrast</strong> and <strong>with suitable use cases</strong> &mdash; three things are being asked for: the definitions, the comparison table, and a use case per model. Draw the table (it is seven comparisons in a small space) and finish with the three use cases named as kinds of organisation, not products.</p>
</div>`
    }
  ]
};

;
/* ch6.js */
/* Chapter 6 — Virtualization and Cloud Architecture.

   Syllabus unit 6: 6 hours, 8 marks. Sub-topics 6.1 Basics of virtualization:
   Hypervisors (Type I & II), 6.2 Virtual Machines vs Containers, 6.3 Cloud
   reference architecture, 6.4 Resource management and provisioning.

   Written from Er. Avijit Karn's 47-slide Chapter 6 deck, read into
   `_source/dcc/lecture_notes_all_chapterwise_ch6_virtlzn_cloud_ref_arch_resrcprovsnmgmt.txt`
   by tools/dcc_extract.py. This is the deck with the most content inside its
   slide pictures — 41 of its 47 slides carry text in images — so the recovered
   picture text is what the definitions of the six virtualization types, the
   Type I / Type II comparison, the NoHype slide and the three provisioning
   methods below are written from.

   Model Question 2025, Group B question 11 (hypervisor Type I versus Type II,
   4 marks) is answered in 6.1.4; Unit 9's cloud-native question builds on the
   containers material in 6.2. */

window.CHAPTERS = window.CHAPTERS || {};
window.CHAPTERS[6] = {
  learn: `

<h2>Unit 6 &mdash; Virtualization and Cloud Architecture</h2>
<p class="unit-meta">Syllabus: 6 hours &middot; 8 marks &middot; sub-topics 6.1&ndash;6.4</p>

<p>Read the unit in two halves. <strong>6.1 and 6.2</strong> are the mechanism: what a hypervisor is, the two types, how it virtualizes CPU, memory and I/O, and why a virtual machine is not the same thing as a container. <strong>6.3 and 6.4</strong> are the architecture built on it: the reference model the deck draws from the NIST picture, and the work of running the result &mdash; provisiong, scheduling, migration and the management stack. Almost every sentence in the first half is the answer to the exam question in the box, and almost every sentence in the second half is a Unit 7 or Unit 9 idea arriving early.</p>

<div class="concept-box asked">
<h4>What this unit is worth in the exam</h4>
<ul>
<li><strong>4 marks</strong> &mdash; &ldquo;Explain the difference between a hypervisor Type I and Type II.&rdquo; (Group B, question 11 of the <em>Model Question 2025</em>)</li>
</ul>
<p>One question in the model paper, but the unit is weighted at 8 marks &mdash; the joint highest with Unit 8 &mdash; and it is the unit that explains <em>how</em> the cloud works, so its vocabulary is used by the Unit 9 question on cloud-native architectures and by Unit 8's security question (a hypervisor is an attack surface, and this unit even names the attack). Read it for the mechanism, not just the marks.</p>
</div>

<h2>6.1 Basics of virtualization</h2>

<h3>6.1.1 The definition, and why it is the foundation of cloud computing</h3>
<div class="concept-box key">
<p><strong>Virtualization is the ability to run multiple operating systems on a single physical system and share the underlying hardware resources. It is the process by which one computer hosts the appearance of many computers.</strong></p>
<p><strong>Virtualization is used to improve IT throughput and costs by using physical resources as a pool from which virtual resources can be allocated.</strong></p>
</div>

<p>Every defining attribute in Unit 5 follows from this sentence. <strong>Elasticity</strong> is possible because a virtual machine can be created or destroyed on demand instead of a physical one being bought; <strong>pay-per-usage</strong> is possible because resources can be metered per virtual machine; <strong>multiplexing and higher utilisation</strong> are possible because several guests share one box; and <strong>a single administrative domain</strong> becomes meaningful because the pool of resources is virtual rather than a room of heterogeneous machines. When a question asks why cloud computing became possible, virtualization is part of the answer.</p>

<p><strong>The architecture</strong> is a stack: a <strong>physical box</strong>, a <strong>virtualization platform</strong> (Xen, KVM, VMware), and above it the virtual systems. A <strong>virtual machine (VM) is an isolated runtime environment</strong> comprising a guest OS and its applications, and <strong>multiple virtual systems can run on a single physical system</strong>.</p>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s03-079.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s03-079.webp" alt="Virtualization Architecture" width="413" height="186" loading="lazy" decoding="async">
<figcaption><strong>slide 3</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx &mdash; Virtualization Architecture</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>6.1.2 The six kinds of virtualization</h3>
<p>The deck separates virtualization into six types, and a question asking "explain the types of virtualization" wants these named with one line each:</p>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s07-083.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s07-083.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 7" width="1175" height="742" loading="lazy" decoding="async">
<figcaption><strong>slide 7</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s08-084.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s08-084.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 8" width="1170" height="738" loading="lazy" decoding="async">
<figcaption><strong>slide 8</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s09-085.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s09-085.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 9" width="1166" height="706" loading="lazy" decoding="async">
<figcaption><strong>slide 9</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<table class="comparison-table">
<thead>
<tr><th>Type</th><th>What is virtualized</th><th>The deck's description</th></tr>
</thead>
<tbody>
<tr><td><strong>Application</strong></td><td>The application, from the machine it appears to run on.</td><td>The application is stored and run <strong>from a server</strong>: the server holds all personal information and other characteristics of the application, but the application can still run <strong>on a local workstation through the internet</strong>, and it can run <strong>from a separate computer from the one on which it is installed</strong>. Apps are delivered from a server to an end user's computer, and <strong>for the user the experience of the virtualized app is the same as using the installed app on a physical machine</strong>.</td></tr>
<tr><td><strong>Network</strong></td><td>Networks: separate control and data planes.</td><td><strong>The ability to run multiple virtual networks, each with a separate control and data plane, co-existing together on top of one physical network.</strong> Each can be <strong>managed by individual parties that are potentially confidential to each other</strong>. Logical switches, routers, firewalls, load balancers, VPNs and workload security can be created, making them operate as <strong>single or multiple independent networks</strong>.</td></tr>
<tr><td><strong>Desktop</strong></td><td>The desktop environment and its applications.</td><td>It <strong>separates the desktop environment and its applications from the physical client device used to access it</strong>, letting a user <strong>access their desktop virtually from any location on a different machine</strong>. Users who need an OS other than Windows Server need a virtual desktop, and it centralises <strong>management of software installation, updates and patches</strong> in the data centre.</td></tr>
<tr><td><strong>Storage</strong></td><td>Physical storage devices.</td><td>It aggregates physical storage <strong>into what appears to be a single storage device &mdash; or a pool of available storage capacity &mdash; managed from a central console</strong>. <strong>The servers are not aware of exactly where their data is stored</strong> and function more like worker bees in a hive. The technology <strong>relies on software to identify available capacity from physical devices and aggregate it into a pool</strong> used by traditional architecture servers or by VMs.</td></tr>
<tr><td><strong>Server</strong></td><td>One physical server into several isolated servers.</td><td>Creating <strong>unique and isolated virtual servers by means of a software application, each able to run its own operating system independently</strong> &mdash; a <strong>masking of server resources</strong> in which <strong>the central physical server is divided into multiple virtual servers by changing the identity number and processors</strong>, each operating its own OS in isolation. Each sub-server knows the identity of the central server, and it <strong>increases performance and reduces operating cost</strong> by deploying main-server resources into sub-server resources. It is beneficial in <strong>virtual migration, reducing energy consumption and reducing infrastructural cost</strong>.</td></tr>
<tr><td><strong>Data</strong></td><td>Data from many sources, presented as one view.</td><td>Data is <strong>collected from various sources and managed in a single place without knowing the technical detail of how it is collected, stored or formatted</strong>, then <strong>arranged logically so its virtual view can be accessed remotely by interested people, stakeholders and users through cloud services</strong>. Large vendors provide it (Oracle, IBM, CData), and its tasks include <strong>data integration, business integration, service-oriented-architecture data services and searching organisational data</strong>.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s04-080.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s04-080.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 4" width="1184" height="667" loading="lazy" decoding="async">
<figcaption><strong>slide 4</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s05-081.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s05-081.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 5" width="1180" height="708" loading="lazy" decoding="async">
<figcaption><strong>slide 5</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s06-082.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s06-082.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 6" width="1166" height="648" loading="lazy" decoding="async">
<figcaption><strong>slide 6</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s10-086.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s10-086.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 10" width="1156" height="739" loading="lazy" decoding="async">
<figcaption><strong>slide 10</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>6.1.3 The hypervisor</h3>
<p><strong>A hypervisor &mdash; also called a virtual machine manager/monitor (VMM), or virtualization manager &mdash; is a program that allows multiple operating systems to share a single hardware host.</strong> The mechanism, in the deck's words: <strong>each guest operating system appears to have the host's processor, memory and other resources all to itself; however, the hypervisor is actually controlling the host processor and resources, allocating what is needed to each operating system in turn, and making sure the guest operating systems (the virtual machines) cannot disrupt each other.</strong></p>

<p>It <strong>supports hardware-level virtualization on bare-metal devices such as CPU, memory, disk and network interfaces</strong>, and <strong>the hypervisor software sits directly between the physical hardware and its OS</strong>. This virtualization layer is referred to as either the VMM or the hypervisor, and <strong>it provides hypercalls for the guest OSes and applications</strong>.</p>

<p>Three things in that definition are worth pulling out. First, the illusion is <strong>bidirectional</strong>: each guest sees the processor, memory and devices <em>as its own</em>, and the hypervisor is what keeps that belief safe by allocating the real resources in turn. Second, the word <strong>isolation</strong> does the commercial work &mdash; guest operating systems "cannot disrupt each other" is exactly what allows a provider to sell slices of one machine to unrelated customers, so the security property and the business model are the same sentence (5.2's management characteristic, and Unit 8's shared-responsibility question). Third, the <strong>hypercall</strong> interface is the only door between a guest and the hardware, which is why a hypervisor is both a layer of protection and a layer worth attacking (Unit 8).</p>

<h3>6.1.4 Type I versus Type II &mdash; Group B, question 11</h3>

<table class="comparison-table">
<thead>
<tr><th></th><th>Type I</th><th>Type II</th></tr>
</thead>
<tbody>
<tr><td><strong>Where it runs</strong></td><td><strong>Directly on the underlying host system</strong> &mdash; it does not require any base server operating system.</td><td>It <strong>does not run directly over the underlying hardware; it runs as an application in a host system (physical machine)</strong>.</td></tr>
<tr><td><strong>Other names</strong></td><td><strong>Native hypervisor</strong> or <strong>bare-metal hypervisor</strong>.</td><td><strong>Hosted hypervisor.</strong></td></tr>
<tr><td><strong>Hardware access</strong></td><td><strong>Has direct access to hardware resources.</strong></td><td>Reaches hardware through the host operating system, adding a layer and its overhead.</td></tr>
<tr><td><strong>Typical use</strong></td><td>Servers and data centres &mdash; the case for cloud computing, where the hypervisor is the platform the cloud is built on.</td><td>Desktop and development use, where a user runs a second OS inside their existing one.</td></tr>
<tr><td><strong>Examples</strong></td><td><strong>Xen</strong> (used by Amazon EC2 and IBM Blue Cloud), KVM, VMware ESXi.</td><td>VMware Workstation, Oracle VirtualBox.</td></tr>
</tbody>
</table>

<p>For the 4-mark question, draw the difference as a layer rather than describing it, because the layer <em>is</em> the difference: a Type I hypervisor sits on the bare machine with guests above it and no host operating system underneath, while a Type II hypervisor is an application inside a host OS, so a guest's I/O passes through two operating systems on the way to a disk. Everything else in the table follows from that one fact &mdash; direct hardware access and native names for Type I, drivers and user experience supplied by the host for Type II, data centres against desktops. Say both sentences and the mark scheme is satisfied: <strong>the same function, one layer apart</strong>.</p>
<figure class="figure-wide figure-wrap">
<svg class="figure wide" viewBox="0 0 780 320" role="img" aria-label="Type I hypervisor runs directly on the hardware with guest operating systems above it; Type II hypervisor runs as an application on a host operating system, with guest operating systems above that">
<defs><marker id="f6a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="flow-arrow-head"/></marker></defs>

<text class="flow-label" x="200" y="26" text-anchor="middle">Type I &mdash; native / bare metal</text>
<rect class="flow-box phase1" x="60" y="44" width="130" height="40" rx="8"/><text class="flow-text" x="125" y="69">Guest OS 1</text>
<rect class="flow-box phase1" x="210" y="44" width="130" height="40" rx="8"/><text class="flow-text" x="275" y="69">Guest OS 2</text>
<rect class="flow-box phase2" x="60" y="108" width="280" height="46" rx="9"/>
<text class="flow-text" x="200" y="136">Hypervisor (VMM)</text>
<rect class="flow-box phase4" x="60" y="178" width="280" height="44" rx="9"/>
<text class="flow-text" x="200" y="205">Physical hardware</text>
<text class="flow-label" x="200" y="250" text-anchor="middle">No host OS between the hypervisor and the hardware.</text>
<text class="flow-label" x="200" y="272" text-anchor="middle">Direct access to CPU, memory, disk and NIC.</text>

<text class="flow-label" x="580" y="26" text-anchor="middle">Type II &mdash; hosted</text>
<rect class="flow-box phase1" x="440" y="44" width="130" height="40" rx="8"/><text class="flow-text" x="505" y="69">Guest OS 1</text>
<rect class="flow-box phase1" x="590" y="44" width="130" height="40" rx="8"/><text class="flow-text" x="655" y="69">Guest OS 2</text>
<rect class="flow-box phase2" x="440" y="108" width="280" height="46" rx="9"/>
<text class="flow-text" x="580" y="136">Hypervisor (an application)</text>
<rect class="flow-box phase3" x="440" y="178" width="280" height="44" rx="9"/>
<text class="flow-text" x="580" y="205">Host operating system</text>
<text class="flow-label" x="580" y="250" text-anchor="middle">The guest pays for the host OS layer above the</text>
<text class="flow-label" x="580" y="272" text-anchor="middle">hardware, but the host OS provides the device drivers.</text>
</svg>
<figcaption><strong>Fig 6.1 &mdash; The two hypervisor types.</strong> The difference is one layer: a Type I hypervisor replaces the host operating system, a Type II hypervisor runs on top of it. That single layer is why data centres use Type I (performance, direct hardware access, no host OS to attack or patch) and desktops use Type II (the host OS supplies the drivers and the user experience).</figcaption>
</figure>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s12-087.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s12-087.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 12" width="1159" height="737" loading="lazy" decoding="async">
<figcaption><strong>slide 12</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>6.1.5 The roles of a hypervisor</h3>
<p>The deck lists them as five responsibilities, and they map exactly onto the resources virtualized:</p>
<ul>
<li><strong>Isolating and emulating resources</strong> &mdash; the general responsibility.</li>
<li><strong>CPU</strong> &mdash; <strong>scheduling virtual machines.</strong></li>
<li><strong>Memory</strong> &mdash; <strong>managing memory.</strong></li>
<li><strong>I/O</strong> &mdash; <strong>emulating I/O devices.</strong></li>
<li><strong>Networking</strong>, and <strong>managing virtual machines</strong>.</li>
</ul>
<p>Each of the next three sub-sections is one of those roles made concrete, and it is worth seeing why they are separate jobs at all. <strong>CPU</strong> has to decide how much of a real processor each guest gets and in what order, which is a scheduling problem with a fairness question attached (this unit's 6.4.2 returns to it as "efficient VM provisioning"). <strong>Memory</strong> has to give each guest a private address space that it believes is the whole machine, which cannot be done with one page table &mdash; hence the two-stage mapping below. <strong>I/O</strong> and <strong>networking</strong> have to <em>emulate devices the guest expects to find</em>, because an unmodified operating system looks for a disk controller and a network card and will not boot without one; that emulation is why a VM's I/O is the slowest thing it does, and why pass-through devices exist. <strong>Managing virtual machines</strong> is the odd one out in the list: it is the provider's side of the same layer &mdash; starting, stopping, snapshotting and migrating guests.</p>

<h3>6.1.6 CPU virtualization</h3>
<p><strong>A VM is a duplicate of an existing computer system in which the majority of the VM's instructions are executed on the host processor in native mode</strong>, so <strong>unprivileged instructions of VMs run directly on the host machine for higher efficiency</strong>. The interesting instructions are the rest, and the deck divides the critical ones into three categories:</p>
<table class="comparison-table">
<thead>
<tr><th>Category</th><th>Definition</th></tr>
</thead>
<tbody>
<tr><td><strong>Privileged instructions</strong></td><td><strong>Execute in a privileged mode and will be trapped if executed outside this mode.</strong></td></tr>
<tr><td><strong>Control-sensitive instructions</strong></td><td><strong>Attempt to change the configuration of resources used.</strong></td></tr>
<tr><td><strong>Behavior-sensitive instructions</strong></td><td><strong>Have different behaviours depending on the configuration of resources, including the load and store operations over the virtual memory.</strong></td></tr>
</tbody>
</table>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s17-091.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s17-091.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 17" width="1104" height="790" loading="lazy" decoding="async">
<figcaption><strong>slide 17</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p><strong>A CPU architecture is virtualizable if it supports the ability to run the VM's privileged and unprivileged instructions in the CPU's user mode while the VMM runs in supervisor mode.</strong> When those privileged, control-sensitive and behaviour-sensitive instructions are executed by a VM they are <strong>trapped in the VMM</strong>, and <strong>the VMM acts as a unified mediator for hardware access from different VMs to guarantee the correctness and stability of the whole system</strong>.</p>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s18-092.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s18-092.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 18" width="1101" height="663" loading="lazy" decoding="async">
<figcaption><strong>slide 18</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<div class="concept-box warn">
<h4>The fact that explains a lot of computing history</h4>
<p><strong>Not all CPU architectures are virtualizable. RISC architectures can be naturally virtualized, because all control- and behaviour-sensitive instructions are privileged instructions</strong> &mdash; so trapping is enough. <strong>On the contrary, x86 CPU architectures were not primarily designed to support virtualization</strong>, because some sensitive instructions were not privileged and therefore did not trap. That is why x86 virtualization needed either binary translation, paravirtualization (as in Xen's original design) or, later, hardware-assisted virtualization extensions. If an exam asks why virtualization was easier on some architectures than others, this is the answer.</p>
</div>

<h3>6.1.7 Memory virtualization</h3>
<p><strong>Virtual memory virtualization is similar to the virtual memory support provided by modern operating systems.</strong> In a traditional execution environment, <strong>the operating system maintains mappings of virtual memory to machine memory using page tables &mdash; a one-stage mapping from virtual memory to machine memory</strong>, and modern x86 CPUs include a <strong>memory management unit (MMU)</strong> and a <strong>translation lookaside buffer (TLB)</strong> to optimise it.</p>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s19-093.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s19-093.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 19" width="1082" height="610" loading="lazy" decoding="async">
<figcaption><strong>slide 19</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>In a virtual execution environment things change: <strong>virtual memory virtualization involves sharing the physical system memory in RAM and dynamically allocating it to the physical memory of the VMs</strong>, and a <strong>two-stage mapping process must be maintained by the guest OS and the VMM respectively</strong>:</p>
<ul>
<li><strong>The guest OS continues to control the mapping of virtual addresses (VA) to the physical memory addresses (PA) of its VM.</strong></li>
<li><strong>The VMM is responsible for mapping the guest physical memory to the actual machine memory (MA).</strong></li>
</ul>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s20-094.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s20-094.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 20" width="1087" height="471" loading="lazy" decoding="async">
<figcaption><strong>slide 20</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s21-095.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s21-095.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 21" width="1127" height="684" loading="lazy" decoding="async">
<figcaption><strong>slide 21</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<figure class="figure-wide figure-wrap">
<svg class="figure wide" viewBox="0 0 760 260" role="img" aria-label="Two-level memory mapping: two virtual machines each map their processes' virtual addresses to guest physical addresses, and the VMM maps guest physical addresses to machine addresses on the physical hardware">
<defs><marker id="f6b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="flow-arrow-head"/></marker></defs>

<rect class="flow-box phase1" x="30" y="40" width="90" height="36" rx="8"/><text class="flow-label" x="75" y="63" text-anchor="middle">Process 1</text>
<rect class="flow-box phase1" x="30" y="90" width="90" height="36" rx="8"/><text class="flow-label" x="75" y="113" text-anchor="middle">Process 2</text>
<rect class="flow-box phase1" x="170" y="40" width="90" height="36" rx="8"/><text class="flow-label" x="215" y="63" text-anchor="middle">Process 1</text>

<rect class="flow-box phase2" x="300" y="60" width="110" height="46" rx="9"/><text class="flow-text" x="355" y="88">VM 1</text>
<rect class="flow-box phase2" x="300" y="140" width="110" height="46" rx="9"/><text class="flow-text" x="355" y="168">VM 2</text>

<rect class="flow-box phase3" x="500" y="60" width="140" height="46" rx="9"/><text class="flow-text" x="570" y="82">Guest physical</text><text class="flow-text" x="570" y="100">address (PA)</text>
<rect class="flow-box phase4" x="500" y="140" width="140" height="46" rx="9"/><text class="flow-text" x="570" y="162">Machine address</text><text class="flow-text" x="570" y="180">(MA)</text>

<rect class="flow-box phase4" x="300" y="215" width="340" height="34" rx="8"/>
<text class="flow-text" x="470" y="237">Physical hardware &mdash; RAM, MMU, TLB</text>

<path class="flow-arrow" d="M124,58 H166" marker-end="url(#f6b)"/>
<text class="flow-label" x="145" y="132" text-anchor="middle">VA</text>
<path class="flow-arrow" d="M264,58 C284,58 286,80 296,82" marker-end="url(#f6b)"/>
<path class="flow-arrow" d="M264,98 C284,98 286,158 296,162" marker-end="url(#f6b)"/>
<path class="flow-arrow" d="M414,80 H496" marker-end="url(#f6b)"/>
<path class="flow-arrow" d="M414,160 H496" marker-end="url(#f6b)"/>
<text class="flow-label" x="455" y="60" text-anchor="middle">stage 1</text>
<path class="flow-arrow" d="M570,110 V136" marker-end="url(#f6b)"/>
<text class="flow-label" x="636" y="128" text-anchor="middle">stage 2 (VMM)</text>
<path class="flow-arrow" d="M570,190 V211" marker-end="url(#f6b)"/>

<text class="flow-label" x="150" y="238" text-anchor="middle">Stage 1 &mdash; the guest OS maps its processes' virtual addresses to the VM's physical memory.</text>
<text class="flow-label" x="150" y="258" text-anchor="middle">Stage 2 &mdash; the VMM maps that guest physical memory to real machine memory.</text>
</svg>
<figcaption><strong>Fig 6.2 &mdash; Two-level (nested) memory mapping.</strong> The one-stage mapping of a traditional OS becomes two stages, because the guest OS can only be allowed to manage memory it has been given &mdash; it must not know about, or be able to address, the rest of the machine. The extra translation is the reason memory virtualization costs performance, which is what hardware-assisted techniques (such as nested page tables) recover.</figcaption>
</figure>

<p>Why the second stage is needed follows from the isolation rule of 6.1.3. The guest OS must be allowed to page its own processes without being able to name, or even discover, memory belonging to another guest or to the hypervisor &mdash; so its page tables may only ever map guest physical addresses, and the VMM owns the mapping from there to real machine memory. The price is one extra translation on every memory access, which is why hardware support exists for it: <strong>nested page tables</strong> (Intel EPT, AMD RVI) let the processor walk both levels without trapping to the hypervisor, and the TLB caches the result. If a question asks why memory virtualization costs performance, that is the answer &mdash; two lookups where a physical machine does one &mdash; and the mitigation is the pattern for CPU and I/O as well: do less in software and let the hardware do more.</p>

<h3>6.1.8 I/O virtualization</h3>
<p>The deck describes three approaches and then the trade-off between them:</p>
<table class="comparison-table">
<thead>
<tr><th>Approach</th><th>How it works</th><th>Trade-off</th></tr>
</thead>
<tbody>
<tr><td><strong>Full device emulation</strong></td><td><strong>Emulates well-known, real-world devices: all the functions of a device or bus infrastructure &mdash; device enumeration, identification, interrupts and DMA &mdash; are replicated in software</strong>, and that software <strong>is located in the VMM and acts as a virtual device</strong>. The guest OS's I/O access requests are <strong>trapped in the VMM, which interacts with the I/O devices</strong>.</td><td>Compatible with unmodified guests, but <strong>requires a very high overhead of device emulation</strong>.</td></tr>
<tr><td><strong>Direct I/O</strong></td><td><strong>Lets the VM access devices directly</strong>, achieving <strong>close-to-native performance without high CPU costs</strong>.</td><td><strong>Current implementations focus on networking for mainframes</strong>, and there are <strong>many challenges for commodity hardware devices</strong>. For example, <strong>when a physical device is reclaimed for later reassignment because of workload migration, it may have been left in an arbitrary state &mdash; DMA to some arbitrary memory location, say &mdash; which can function incorrectly or crash the whole system</strong>.</td></tr>
<tr><td><strong>Hardware-assisted</strong></td><td>Support in the hardware for the remapping and isolation that emulation was doing in software.</td><td>The deck's conclusion: <strong>since software-based I/O virtualization requires a very high overhead of device emulation, hardware-assisted I/O virtualization is critical</strong>.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s22-096.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s22-096.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 22" width="1120" height="680" loading="lazy" decoding="async">
<figcaption><strong>slide 22</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s24-098.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s24-098.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 24" width="1122" height="630" loading="lazy" decoding="async">
<figcaption><strong>slide 24</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>What the virtual device does, in the deck's diagram: <strong>it remaps guest and real I/O addresses, multiplexes and drives the physical device, and adds I/O features such as copy-on-write disks.</strong></p>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s23-097.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s23-097.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 23" width="1075" height="733" loading="lazy" decoding="async">
<figcaption><strong>slide 23</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>6.1.9 The Xen architecture</h3>
<p><strong>Xen is an open-source hypervisor program developed by Cambridge University.</strong> It is a <strong>micro-kernel hypervisor which separates the policy from the mechanism</strong>: <strong>the Xen hypervisor implements all the mechanisms, leaving the policy to be handled by Domain 0</strong>. <strong>Xen does not include any device drivers natively</strong> &mdash; it <strong>just provides a mechanism by which a guest OS can have direct access to the physical devices</strong>. As a result <strong>the size of the Xen hypervisor is kept rather small</strong>, and it <strong>provides a virtual environment located between the hardware and the OS</strong>. The core components of a Xen system are <strong>the hypervisor, the kernel and the applications</strong>.</p>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s14-088.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s14-088.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 14" width="1161" height="628" loading="lazy" decoding="async">
<figcaption><strong>slide 14</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>The domain distinction is examinable: <strong>the guest OS that has control ability is called Domain 0, and the others are called Domain U.</strong> <strong>Domain 0 is a privileged guest OS</strong>; it is <strong>first loaded when Xen boots, without any file-system drivers being available</strong>, and it is <strong>designed to access hardware directly and manage devices</strong>. Therefore <strong>one of its responsibilities is to allocate and map hardware resources for the guest domains (the Domain U domains)</strong>.</p>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s15-089.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s15-089.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 15" width="1173" height="686" loading="lazy" decoding="async">
<figcaption><strong>slide 15</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s16-090.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s16-090.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 16" width="1175" height="412" loading="lazy" decoding="async">
<figcaption><strong>slide 16</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>6.1.10 Benefits of virtualization</h3>
<p>Five benefits, and they are a good closing list for the 6.1 material &mdash; each one is a cloud property from Unit 5 restated at the machine level:</p>
<table class="comparison-table">
<thead>
<tr><th>Benefit</th><th>The deck's statement</th><th>What it enables in the cloud</th></tr>
</thead>
<tbody>
<tr><td><strong>Sharing of resources</strong></td><td>Helps <strong>cost reduction</strong>.</td><td>The multiplexing that makes pay-per-usage economical.</td></tr>
<tr><td><strong>Isolation</strong></td><td><strong>Virtual machines are isolated from each other as if they were physically separated.</strong></td><td>Multi-tenancy: one provider serves customers who do not trust each other.</td></tr>
<tr><td><strong>Encapsulation</strong></td><td><strong>A VM encapsulates a complete computing environment.</strong></td><td>Templates and images: a whole machine becomes one file that can be copied.</td></tr>
<tr><td><strong>Hardware independence</strong></td><td><strong>VMs run independently of the underlying hardware.</strong></td><td>Portability across a provider's fleet, and no vendor-specific hardware lock-in.</td></tr>
<tr><td><strong>Portability</strong></td><td><strong>VMs can be migrated between different hosts.</strong></td><td><strong>Live migration</strong>, which is what makes maintenance and load balancing invisible &mdash; and what 6.4 assumes.</td></tr>
</tbody>
</table>

<p>The five are not five separate advantages; they are one mechanism seen five times, and stating that is what turns the list into an answer. Isolation is what makes multi-tenancy possible, so it is why a public cloud can exist at all (5.4.1). Encapsulation is what makes a machine <em>portable as data</em> &mdash; a whole computing environment in one file &mdash; which is how templates, images and snapshots work. Hardware independence is what stops a workload from being tied to a particular server, so capacity can be added anywhere in a fleet. Portability plus encapsulation is what lives behind live migration, the technique that lets a provider patch or rebalance a host without a customer noticing, and therefore the reason availability can be promised in a contract (Unit 8.3). Sharing comes first because it is the money: the same physical machine earns from many tenants.</p>

<h3>6.1.11 Hypervisor vulnerabilities, and NoHype</h3>
<p>The security consequence sits in this unit because it is architectural: <strong>since the hypervisor sits between every guest and the hardware, it is a single point of attack that can see every guest.</strong> The deck's statement of the threat &mdash; <strong>malicious software can run on the same server, attack the hypervisor, and access or obstruct other VMs</strong> &mdash; is the reasoning behind Unit 8's multi-tenancy risk, and the word for it is <em>VM escape</em>.</p>
<p>The deck presents one research answer, <strong>NoHype</strong>: <strong>it removes the hypervisor &mdash; there is nothing to attack</strong>. It is <strong>a complete systems solution</strong> that <strong>still retains the needs of a virtualized cloud infrastructure</strong> (the reference is Keller, Szefer, Rexford and Lee, <em>NoHype: Virtualized Cloud Infrastructure without the Virtualization</em>, ISCA 2010). The point to take from it is the trade-off it exposes: the isolation the hypervisor provides is also the isolation it must be trusted to provide, and removing it means proving the hardware can do the job instead.</p>

<h2>6.2 Virtual machines versus containers</h2>

<h3>6.2.1 What a virtual machine is</h3>
<p><strong>A virtual machine (VM) is best described as a software program that emulates the functionality of physical hardware or a computing system.</strong> It <strong>runs on top of emulating software called the hypervisor, which replicates the functionality of the underlying physical hardware resources in a software environment</strong>. Those resources may be referred to as <strong>the host machine</strong>, while <strong>the VM that runs on the hypervisor is often called a guest machine</strong>.</p>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s30-100.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s30-100.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 30" width="970" height="483" loading="lazy" decoding="async">
<figcaption><strong>slide 30</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p><strong>The VM contains all the elements necessary to run its applications</strong>: storage, memory, networking, and hardware functionality available as a virtualized system. <strong>It may also contain the necessary system binaries and libraries</strong> &mdash; but <strong>the actual operating system is managed and executed using the hypervisor</strong>. The idea, as the deck states it, is <strong>to create a small layer between the hardware and the operating system that performs this abstraction, called the hypervisor</strong>.</p>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s31-101.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s31-101.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 31" width="1178" height="454" loading="lazy" decoding="async">
<figcaption><strong>slide 31</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>Keep the vocabulary straight, because exam answers are marked on it: the <strong>host machine</strong> is the physical hardware, the <strong>guest</strong> is the VM running on it, and the <strong>hypervisor</strong> is the layer in between. What makes a VM a <em>machine</em> rather than a process is the sentence above &mdash; it carries everything needed to run its applications, including the system binaries and libraries, and the only thing it does not own is the operating system kernel, which the hypervisor executes for it. That is also the property that makes a VM heavy: a guest usually runs a complete operating system of its own, which is where containers (6.2.2) take a different decision, and it is why a VM image is measured in gigabytes where a container image is measured in megabytes.</p>
<h3>6.2.2 What a container is</h3>
<p><strong>Containerization creates abstraction at an OS level that allows individual, modular and distinct functionality of the app to run independently</strong>, so that <strong>several isolated workloads &mdash; the containers &mdash; can dynamically operate using the same physical resources</strong>. A less technical definition, and a good one to quote: <strong>a container is a unit of software that is lightweight but still bundles the code, its dependencies and the configuration altogether into a single image</strong>. Containers can run <strong>on top of bare-metal servers, on top of hypervisors, or in cloud infrastructure</strong>.</p>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s33-103.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s33-103.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 33" width="966" height="539" loading="lazy" decoding="async">
<figcaption><strong>slide 33</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<div class="concept-box key">
<h4>The one difference that defines containers</h4>
<p>Containers <strong>share all the necessary capabilities with a VM to operate as an isolated OS environment for a modular app's functionality, with one key difference: using a containerization engine such as the Docker Engine, containers create several isolated OS environments within the same host system kernel</strong>, which can be shared with other containers dedicated to running different functions of the application. <strong>Only binaries, libraries and other runtime components are developed or executed separately for each container, which makes them more resource-efficient compared to VMs.</strong> In the deck's phrasing, the idea is to <strong>virtualize the layers above the host OS</strong> &mdash; instead of giving every application its own operating system, give it its own user space above one shared kernel.</p>
</div>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s34-104.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s34-104.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 34" width="1170" height="478" loading="lazy" decoding="async">
<figcaption><strong>slide 34</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s34-105.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s34-105.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 34" width="1165" height="399" loading="lazy" decoding="async">
<figcaption><strong>slide 34</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<figure class="figure-wide figure-wrap">
<svg class="figure wide" viewBox="0 0 800 330" role="img" aria-label="Side by side stacks: in the virtual machine model each application has its own guest operating system above the hypervisor; in the container model applications share the host operating system and the container engine">
<defs><marker id="f6c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="flow-arrow-head"/></marker></defs>

<text class="flow-label" x="215" y="24" text-anchor="middle">Virtual machines</text>
<text class="flow-label" x="600" y="24" text-anchor="middle">Containers</text>

<rect class="flow-box phase1" x="60" y="40" width="110" height="34" rx="7"/><text class="flow-label" x="115" y="62" text-anchor="middle">App A</text>
<rect class="flow-box phase1" x="180" y="40" width="110" height="34" rx="7"/><text class="flow-label" x="235" y="62" text-anchor="middle">App B</text>
<rect class="flow-box phase2" x="60" y="84" width="110" height="34" rx="7"/><text class="flow-label" x="115" y="106" text-anchor="middle">Bins/Libs</text>
<rect class="flow-box phase2" x="180" y="84" width="110" height="34" rx="7"/><text class="flow-label" x="235" y="106" text-anchor="middle">Bins/Libs</text>
<rect class="flow-box phase3" x="60" y="128" width="110" height="34" rx="7"/><text class="flow-label" x="115" y="150" text-anchor="middle">Guest OS</text>
<rect class="flow-box phase3" x="180" y="128" width="110" height="34" rx="7"/><text class="flow-label" x="235" y="150" text-anchor="middle">Guest OS</text>
<rect class="flow-box phase2" x="60" y="172" width="230" height="38" rx="8"/><text class="flow-label" x="175" y="196" text-anchor="middle">Hypervisor</text>
<rect class="flow-box phase4" x="60" y="222" width="230" height="38" rx="8"/><text class="flow-label" x="175" y="246" text-anchor="middle">Physical infrastructure</text>
<text class="flow-label" x="175" y="290" text-anchor="middle">Every application carries an operating system</text>
<text class="flow-label" x="175" y="310" text-anchor="middle">of its own &mdash; heavier, and fully isolated.</text>

<rect class="flow-box phase1" x="450" y="40" width="110" height="34" rx="7"/><text class="flow-label" x="505" y="62" text-anchor="middle">App A</text>
<rect class="flow-box phase1" x="570" y="40" width="110" height="34" rx="7"/><text class="flow-label" x="625" y="62" text-anchor="middle">App B</text>
<rect class="flow-box phase2" x="450" y="84" width="110" height="34" rx="7"/><text class="flow-label" x="505" y="106" text-anchor="middle">Bins/Libs</text>
<rect class="flow-box phase2" x="570" y="84" width="110" height="34" rx="7"/><text class="flow-label" x="625" y="106" text-anchor="middle">Bins/Libs</text>
<rect class="flow-box phase2" x="450" y="128" width="230" height="38" rx="8"/><text class="flow-label" x="565" y="152" text-anchor="middle">Container engine (Docker)</text>
<rect class="flow-box phase3" x="450" y="176" width="230" height="38" rx="8"/><text class="flow-label" x="565" y="200" text-anchor="middle">Host operating system</text>
<rect class="flow-box phase4" x="450" y="222" width="230" height="38" rx="8"/><text class="flow-label" x="565" y="246" text-anchor="middle">Physical infrastructure</text>
<text class="flow-label" x="565" y="290" text-anchor="middle">One shared kernel, only the user space repeated</text>
<text class="flow-label" x="565" y="310" text-anchor="middle">&mdash; lighter and faster, less isolated.</text>
</svg>
<figcaption><strong>Fig 6.3 &mdash; Containers versus virtual machines</strong>, following the deck's slides 29 and 31&ndash;34. Read it as one question: <em>how far down does the duplicated stack go?</em> A VM duplicates everything above the hypervisor including the operating system; a container duplicates only the application, its binaries and its libraries, because all containers <strong>share the host system kernel</strong>.</figcaption>
</figure>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s29-099.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s29-099.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 29" width="935" height="420" loading="lazy" decoding="async">
<figcaption><strong>slide 29</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>6.2.3 The comparison, and the costs on each side</h3>
<table class="comparison-table">
<thead>
<tr><th></th><th>Virtual machines</th><th>Containers</th></tr>
</thead>
<tbody>
<tr><td><strong>Abstraction level</strong></td><td>Hardware &mdash; the hypervisor emulates the physical machine, so the guest sees hardware.</td><td><strong>Operating-system level</strong> &mdash; isolated OS environments running on the same host kernel, so the container sees a user space.</td></tr>
<tr><td><strong>What each instance includes</strong></td><td><strong>A full guest operating system</strong> plus system binaries and libraries.</td><td><strong>Only the code, its dependencies and its configuration</strong> in one image; only binaries, libraries and runtime components are separate per container.</td></tr>
<tr><td><strong>Resource efficiency</strong></td><td><strong>Larger size and less portable.</strong></td><td><strong>More resource-efficient compared to VMs</strong>, and faster to start because there is no OS to boot.</td></tr>
<tr><td><strong>Isolation and security</strong></td><td><strong>Separation in terms of computation, logic and storage</strong>, with <strong>full isolation security</strong>, and the hypervisor has <strong>greater control over how much system resources each VM is allocated</strong>.</td><td><strong>Less secure due to sharing of the underlying operating system</strong> &mdash; the deck's example is the Meltdown class of vulnerability. A kernel-level flaw is shared by every container on the host.</td></tr>
<tr><td><strong>Flexibility</strong></td><td><strong>Capable of running VMs with different guest operating systems</strong> &mdash; Windows and Linux side by side on one host.</td><td><strong>All containers must run atop the same kernel</strong>, and there is <strong>less flexibility with respect to hardware requirements</strong>.</td></tr>
<tr><td><strong>Stated advantages</strong></td><td>Separation of computation, logic and storage; different guest OSes; resource control by the hypervisor; full isolation security.</td><td><strong>Compartmentalisation</strong>; <strong>portability</strong> (size, ease of defining a container, versioning); a <strong>great ecosystem</strong>; and <strong>using the host kernel for allocation of resources</strong>.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s32-102.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s32-102.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 32" width="1155" height="599" loading="lazy" decoding="async">
<figcaption><strong>slide 32</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s35-106.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s35-106.webp" alt="Why Containers?" width="972" height="475" loading="lazy" decoding="async">
<figcaption><strong>slide 35</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx &mdash; Why Containers?</figcaption>
</figure>
<!-- /dcc-fig -->
<div class="concept-box tip">
<h4>The summary sentence for an exam</h4>
<p><strong>Both virtualize, but at different levels: a VM virtualizes the machine, so each instance carries its own operating system and gets hardware-level isolation; a container virtualizes the operating system, so instances share one kernel and carry only their own user space, which makes them lighter and faster but less isolated.</strong> The choice is then a sentence of engineering: VMs when guests need different or untrusted kernels; containers when the workload is many copies of one stack that must start quickly.</p>
</div>

<h2>6.3 Cloud reference architecture</h2>

<p>The reference architecture is the NIST model, and it is best memorised as <strong>four layers, three cross-cutting management groups, and six actors</strong>.</p>

<h3>6.3.1 The provider's four layers</h3>
<table class="comparison-table">
<thead>
<tr><th>Layer</th><th>Contents</th><th>What it is</th></tr>
</thead>
<tbody>
<tr><td><strong>Service layer</strong> (also drawn as <em>service orchestration</em> above the service layer)</td><td><strong>SaaS, PaaS, IaaS</strong></td><td>The three delivery models from Unit 5 &mdash; the cloud as the customer sees it.</td></tr>
<tr><td><strong>Resource abstraction and control layer</strong></td><td>The hypervisors, virtual machines and control software.</td><td>Where virtualization lives: it turns physical resources into the pool the service layer sells.</td></tr>
<tr><td><strong>Physical resource layer</strong></td><td><strong>Hardware and facility.</strong></td><td>Servers, storage and network, and the facility that houses them &mdash; power, cooling and physical security. Unit 8's physical-security controls are controls on this layer.</td></tr>
<tr><td><strong>Cloud service management</strong> (a management group rather than a layer, drawn beside them)</td><td><strong>Business support, provisioning/configuration, portability/interoperability.</strong></td><td>The operational functions: what 5.3.1 called the cloud activities. <strong>Portability/interoperability</strong> is the layer that resists vendor lock-in.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s36-107.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s36-107.webp" alt="Cloud Reference Architecture" width="1189" height="696" loading="lazy" decoding="async">
<figcaption><strong>slide 36</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx &mdash; Cloud Reference Architecture</figcaption>
</figure>
<!-- /dcc-fig -->
<p><strong>Three cross-cutting concerns</strong> are drawn as vertical activities through the whole provider: <strong>security, privacy and performance</strong> &mdash; and in the fuller NIST picture, <strong>audit</strong> as well. The point of drawing them vertically is that none of them is a layer: security is a property the service layer, the control layer and the physical layer each have to deliver.</p>

<h3>6.3.2 The actors &mdash; the NIST reference model's terminology</h3>
<table class="comparison-table">
<thead>
<tr><th>Actor</th><th>Definition</th></tr>
</thead>
<tbody>
<tr><td><strong>Consumer</strong></td><td><strong>An entity as the principal stakeholder that maintains a business relationship</strong> with the provider.</td></tr>
<tr><td><strong>Provider</strong></td><td>The entity that makes services available.</td></tr>
<tr><td><strong>Auditor</strong></td><td><strong>A party that conducts an audit with the intent to express an opinion thereon. Audits are performed to verify conformance to standards through review of objective evidence.</strong> This is the actor that makes cloud assurance possible, and <strong>SLA</strong> verification in Unit 8 depends on it.</td></tr>
<tr><td><strong>Broker</strong></td><td>An entity that manages the use, performance and delivery of cloud services and negotiates relationships between providers and consumers, in three forms: <strong>intermediation</strong> (adding value to a service), <strong>aggregation</strong> (combining several services) and <strong>arbitrage</strong> (balancing across providers &mdash; buying low, selling where the demand is).</td></tr>
<tr><td><strong>Developer</strong></td><td>The role that builds applications on the provider's platform.</td></tr>
<tr><td><strong>Carrier</strong></td><td>The role that provides the connectivity &mdash; the <em>network cloud services</em> in 6.4.5.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s37-108.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s37-108.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 37" width="967" height="683" loading="lazy" decoding="async">
<figcaption><strong>slide 37</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<div class="concept-box tip">
<h4>How to draw it in an answer</h4>
<p>Draw the consumer on the left and the provider on the right, with the auditors, brokers and carriers between them. Inside the provider, stack <strong>service layer (SaaS/PaaS/IaaS)</strong> above <strong>resource abstraction and control</strong> above <strong>physical resource (hardware, facility)</strong>, and put <strong>cloud service management</strong> as a column on the right of all three. Then draw <strong>security, privacy and performance</strong> as vertical bars crossing every layer. That one diagram answers "explain the cloud reference architecture" and takes thirty seconds.</p>
</div>

<h2>6.4 Resource management and provisioning</h2>

<h3>6.4.1 The provisioning problem, and the SLA tension</h3>
<div class="concept-box key">
<p><strong>Providers supply cloud services by signing SLAs with end users, and the SLAs must commit sufficient resources &mdash; CPU, memory and bandwidth &mdash; that the user can use for a preset period.</strong> That commitment creates a two-sided error:</p>
<ul>
<li><strong>Underprovisioning of resources will lead to broken SLAs and penalties.</strong></li>
<li><strong>Overprovisioning of resources will lead to resource underutilisation, and consequently a decrease in revenue for the provider.</strong></li>
</ul>
</div>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s39-109.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s39-109.webp" alt="Resource Provisioning" width="1075" height="478" loading="lazy" decoding="async">
<figcaption><strong>slide 39</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx &mdash; Resource Provisioning</figcaption>
</figure>
<!-- /dcc-fig -->
<p>So provisioning is not a technical optimum but a commercial one, and the rest of 6.4 is about how it is done.</p>

<p><strong>The difficulty of deploying an autonomous system to provision resources efficiently</strong> comes from five sources, as the deck lists them: <strong>the unpredictability of consumer demand</strong>; <strong>software and hardware failures</strong>; <strong>heterogeneity of services</strong> (a user may take NaaS, a queue service or SaaS); <strong>power management</strong> &mdash; heat dissipation from servers; and <strong>conflicts in the signed SLAs between consumers and service providers</strong>.</p>

<h3>6.4.2 Efficient VM provisioning</h3>
<p><strong>Efficient VM provisioning depends on the cloud architecture and the management of cloud infrastructures.</strong> In a virtualised cluster of servers, it demands three capabilities: <strong>efficient installation of VMs, live VM migration, and fast recovery from failures</strong>. <strong>To deploy VMs, users treat them as physical hosts with customised operating systems for specific applications.</strong></p>
<p>The concrete products the deck names, all of which are worth one line because they make the theory specific:</p>
<ul>
<li><strong>Amazon's EC2</strong> (Amazon's IaaS service) <strong>uses Xen as the virtual machine monitor (VMM)</strong> &mdash; the same VMM used in <strong>IBM's Blue Cloud</strong>. In EC2, <strong>predefined VM templates are also provided, and users can choose different kinds of VMs from the templates</strong>.</li>
<li><strong>IBM's Blue Cloud does not provide any VM templates</strong>; in general, <strong>any type of VM can run on top of Xen</strong>.</li>
<li><strong>Microsoft also applies virtualization in its Azure cloud platform.</strong></li>
</ul>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s40-110.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s40-110.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 40" width="1079" height="481" loading="lazy" decoding="async">
<figcaption><strong>slide 40</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>The principle stated with them: <strong>the provider should offer resource-economic services</strong>.</p>

<h3>6.4.3 The three provisioning methods</h3>
<table class="comparison-table">
<thead>
<tr><th>Method</th><th>How it decides</th><th>Strength and weakness</th></tr>
</thead>
<tbody>
<tr><td><strong>Demand-driven</strong></td><td><strong>Adds or removes computing instances based on the current utilisation level of the allocated resources.</strong> In general, <strong>when a resource has surpassed a threshold for a certain amount of time the scheme increases that resource based on demand, and when a resource is below a threshold for a certain amount of time it can be decreased accordingly.</strong> The deck's example of the rule: <strong>define a range for CPU utilisation, say 30% to 70% &mdash; below 30% decrease CPU capacity, above 70% increase it.</strong> <strong>Amazon implements such an auto-scale feature in its EC2 platform.</strong></td><td><strong>Easy to implement</strong>, and the natural default. <strong>Disadvantage: the scheme does not work out right if the workload changes abruptly</strong> &mdash; by the time the threshold is crossed the capacity is already needed.</td></tr>
<tr><td><strong>Event-driven</strong></td><td><strong>Adds or removes machine instances based on a specific time event.</strong> It <strong>works better for seasonal or predicted events such as Christmastime in the West and the Lunar New Year in the East</strong>, when <strong>the number of users grows before the event period and then decreases during it</strong>. The scheme <strong>anticipates peak traffic before it happens</strong>.</td><td><strong>Results in a minimal loss of QoS if the event is predicted correctly.</strong> Otherwise <strong>wasted resources are even greater, due to events that do not follow a fixed pattern</strong>.</td></tr>
<tr><td><strong>Popularity-driven</strong></td><td><strong>The Internet is searched for the popularity of certain applications and instances are created by popularity demand</strong> &mdash; the deck's examples of currently popular applications are <strong>Facebook, Instagram and Twitter</strong>. The scheme <strong>anticipates increased traffic with popularity</strong>.</td><td>Again <strong>minimal loss of QoS if the predicted popularity is correct</strong>; <strong>resources may be wasted if traffic does not occur as expected</strong>.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s42-112.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s42-112.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 42" width="1073" height="526" loading="lazy" decoding="async">
<figcaption><strong>slide 42</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s43-113.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s43-113.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 43" width="1077" height="529" loading="lazy" decoding="async">
<figcaption><strong>slide 43</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s44-114.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s44-114.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 44" width="1081" height="412" loading="lazy" decoding="async">
<figcaption><strong>slide 44</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<div class="concept-box warn">
<h4>Note that "Event Driven" is a third method</h4>
<p>The deck's slide 41 names two methods &mdash; demand-driven and popularity-driven &mdash; and then describes <strong>three</strong>, because the event-driven method has its own slide. Write all three: demand-driven (reactive, thresholds, EC2 auto-scale), event-driven (calendar-based, seasonal peaks) and popularity-driven (trend-based). The exam-safe framing is that the first is <em>reactive</em> and the other two are <em>predictive</em>, and both predictive ones share the same failure mode: wasted resources when the prediction is wrong.</p>
</div>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s41-111.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s41-111.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 41" width="460" height="360" loading="lazy" decoding="async">
<figcaption><strong>slide 41</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>6.4.4 The software stack and runtime support</h3>
<p>Two closing ideas from the deck that belong in a long answer about cloud architecture. First, the <strong>software stack</strong>: it is <strong>built from scratch to meet rigorous goals</strong>, so developers must design for <strong>high throughput, high availability and fault tolerance</strong> at every layer &mdash; <strong>even the operating system might be modified to meet the special requirements of cloud data processing</strong>. The stack is <strong>layered, each layer providing an interface for the layers above it just as a traditional software stack does &mdash; however, the lower layers are not completely transparent to the upper layers</strong>, because each layer sells a different thing (SaaS shares software, PaaS shares a platform, IaaS shares hardware).</p>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s46-116.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s46-116.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 46" width="1072" height="520" loading="lazy" decoding="async">
<figcaption><strong>slide 46</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>Second, <strong>runtime support services</strong>: as in a cluster, the cloud has <strong>cluster monitoring to collect the runtime status of the entire cluster</strong> and <strong>a scheduler that queues tasks submitted to the whole cluster and assigns them to processing nodes according to node availability</strong>. The <strong>distributed scheduler for cloud applications has special characteristics &mdash; for example scheduling programs written in MapReduce style</strong> &mdash; and the runtime support system <strong>keeps the cloud cluster working properly with high efficiency</strong>.</p>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s47-117.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s47-117.webp" alt="Diagram from Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx, slide 47" width="1078" height="517" loading="lazy" decoding="async">
<figcaption><strong>slide 47</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>6.4.5 Cloud service tasks and trends</h3>
<p>A short list that is useful for a "current state of the cloud" question, or for Unit 9's emerging trends:</p>
<ul>
<li><strong>SaaS is the top layer</strong>, for business applications. <strong>CRM is heavily practised in business promotion, direct sales and marketing services, and CRM offered the first successful SaaS on the cloud</strong>; the approach widens market coverage by investigating customer behaviour and revealing opportunities through statistical analysis. SaaS tools also apply to <strong>distributed collaboration (Google Docs)</strong> and to <strong>financial and human-resources management</strong>, and these services have grown rapidly.</li>
<li><strong>PaaS</strong> is provided by <strong>Google, Salesforce.com and Facebook</strong> among others; <strong>IaaS</strong> by <strong>Amazon, Windows Azure and Rackspace</strong>.</li>
<li><strong>Collocation services</strong> require <strong>multiple cloud providers to work together</strong> to support supply chains in manufacturing.</li>
<li><strong>Network cloud services</strong> provide communications &mdash; the deck names <strong>AT&amp;T, Qwest and AboveNet</strong>.</li>
</ul>
<!-- dcc-fig:ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s45-115.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch6/ch6-virtlzn-cloud-ref-arch-resrcprovsnmgmt-s45-115.webp" alt="Inter-Cloud Resource Management" width="1073" height="537" loading="lazy" decoding="async">
<figcaption><strong>slide 45</strong> &middot; Ch6_Virtlzn_Cloud-Ref-Arch_ResrcProvsnMgmt.pptx &mdash; Inter-Cloud Resource Management</figcaption>
</figure>
<!-- /dcc-fig -->
<p>Two of those items are more examinable than they look. <strong>CRM being the first successful SaaS</strong> is the historical claim to reproduce if a question asks how the delivery models arrived: the software model that pays per user per month was proved on a business application before it reached consumers. <strong>Collocation</strong> &mdash; several cloud providers working together to support one supply chain &mdash; is the earliest form of what Unit 9 calls multi-cloud, and it is the honest limit of the single-provider picture this unit has drawn: once a business depends on three clouds, the problem stops being virtualization and becomes coordination between providers that do not share an oracle of time or a common control plane (the inter-cloud resource management topic the deck's own slide names).</p>
<div class="concept-box tip">
<h4>The paper-facing part of this unit</h4>
<p>Everything in this unit that is written to be answered in the exam &mdash; what each question asks for, and the model answer to it &mdash; is collected in <a href="#/ch/6/past">Past Questions</a>. Read this tab for the subject; switch to that one when you sit down to answer a question.</p>
</div>
`,

  pastSummary: `<h2>Exam-facing summary</h2>
<table class="comparison-table">
<thead>
<tr><th>If the question says&hellip;</th><th>Give&hellip;</th></tr>
</thead>
<tbody>
<tr><td>Define virtualization</td><td>The ability to run multiple operating systems on one physical system and share the underlying hardware, so that one computer hosts the appearance of many; used to improve IT throughput and costs by treating physical resources as a pool from which virtual resources are allocated.</td></tr>
<tr><td>Explain the types of virtualization</td><td>Application, network, desktop, storage, server and data &mdash; one line each from 6.1.2.</td></tr>
<tr><td>What is a hypervisor?</td><td>A program (VMM) that allows multiple operating systems to share one hardware host: each guest appears to have the processor, memory and resources to itself, while the hypervisor allocates what is needed in turn and prevents guests from disrupting each other. It sits directly between hardware and OS and provides hypercalls; its roles are isolating/emulating resources &mdash; CPU scheduling, memory management, I/O emulation &mdash; networking and managing VMs.</td></tr>
<tr><td>Type I versus Type II (4 marks)</td><td>The table in 6.1.4 and Fig 6.1: where it runs (directly on the host, no base OS &mdash; versus as an application on a host system), the names (native/bare metal versus hosted), hardware access (direct versus through the host OS), use (data centres versus desktops) and examples (Xen, KVM, ESXi versus VMware Workstation, VirtualBox). Xen on EC2 and Blue Cloud is the concrete case.</td></tr>
<tr><td>Explain CPU / memory / I/O virtualization</td><td>CPU: privileged, control-sensitive and behaviour-sensitive instructions, trap-and-emulate, virtualizable architectures, RISC versus x86. Memory: the one-stage page-table mapping becoming two stages (VA to PA by the guest OS, PA to MA by the VMM), with the MMU and TLB. I/O: full device emulation versus direct I/O versus hardware-assisted, with the overhead and the device-reclamation hazard.</td></tr>
<tr><td>What is the Xen architecture?</td><td>An open-source micro-kernel hypervisor from Cambridge University separating policy from mechanism: it implements the mechanisms and leaves policy to Domain 0; no native device drivers; small; Domain 0 is the privileged guest loaded first, accessing hardware directly and allocating resources for Domain U guests.</td></tr>
<tr><td>Benefits of virtualization</td><td>Sharing of resources for cost reduction, isolation as if physically separated, encapsulation of a complete computing environment, hardware independence, and portability with migration between hosts.</td></tr>
<tr><td>Compare VMs and containers</td><td>Abstraction level (hardware versus OS), what each instance includes (a whole guest OS versus code, dependencies and configuration only), resource efficiency (larger and less portable versus more efficient), isolation (full versus weaker, sharing the host kernel), flexibility (different guest OSes versus same kernel), plus the individual pros and cons lists and Fig 6.3.</td></tr>
<tr><td>Explain the cloud reference architecture</td><td>The four layers (service layer with SaaS/PaaS/IaaS, resource abstraction and control, physical resource with hardware and facility, and cloud service management with business support, provisioning/configuration and portability/interoperability), the cross-cutting security/privacy/performance/audit concerns, and the NIST actors (consumer, provider, auditor, broker with intermediation, aggregation and arbitrage, developer, carrier).</td></tr>
<tr><td>Resource provisioning and its problems</td><td>SLAs commit resources for a preset period; underprovisioning breaks SLAs and incurs penalties while overprovisioning causes underutilisation and lost revenue; the five sources of difficulty; and the three methods &mdash; demand-driven with thresholds and EC2 auto-scaling, event-driven for seasonal events, popularity-driven.</td></tr>
</tbody>
</table>


`,

  quiz: [
    {
      q: 'What is virtualization?',
      options: [
        'Installing an application on many machines at once',
        'The ability to run multiple operating systems on a single physical system and share the underlying hardware resources',
        'Converting physical servers into containers',
        'Moving data to a remote data centre'
      ],
      answer: 1,
      explanation: 'It is the process by which one computer hosts the appearance of many computers, used to improve IT throughput and costs by using physical resources as a pool from which virtual resources can be allocated.'
    },
    {
      q: 'A Type I hypervisor is also known as:',
      options: [
        'A hosted hypervisor',
        'A native or bare-metal hypervisor',
        'A guest hypervisor',
        'A container engine'
      ],
      answer: 1,
      explanation: 'Type I runs directly on the underlying host system and requires no base server operating system, which is why it is called native or bare metal; it has direct access to hardware resources. Type II is the hosted hypervisor, which runs as an application in a host system.'
    },
    {
      q: 'Which of these is a Type II hypervisor?',
      options: [
        'Xen',
        'VMware ESXi',
        'Oracle VirtualBox',
        'KVM'
      ],
      answer: 2,
      explanation: 'VirtualBox (and VMware Workstation) run as applications on a host operating system. Xen, KVM and VMware ESXi run directly on the hardware — and Xen is the VMM used by Amazon EC2 and IBM Blue Cloud.'
    },
    {
      q: 'Which is a role of the hypervisor?',
      options: [
        'Compiling applications for the guest OS',
        'Scheduling virtual machines on the CPU, managing memory, emulating I/O devices and networking',
        'Providing the cloud billing system',
        'Encrypting the guest operating systems'
      ],
      answer: 1,
      explanation: 'The deck\'s list: isolating/emulating resources, with CPU for scheduling virtual machines, memory for memory management, I/O for emulating I/O devices, networking, and managing virtual machines.'
    },
    {
      q: 'What happens to a privileged instruction executed by a virtual machine under a VMM?',
      options: [
        'It is executed natively with no overhead',
        'It is trapped in the VMM, which acts as a unified mediator for hardware access from different VMs',
        'It is silently discarded',
        'It crashes the VM'
      ],
      answer: 1,
      explanation: 'Privileged instructions execute in a privileged mode and are trapped if executed outside it. The VMM then mediates hardware access, which is what guarantees correctness and stability for the whole system. Unprivileged instructions of the VM run directly on the host in native mode for efficiency.'
    },
    {
      q: 'Why were x86 architectures harder to virtualize than RISC architectures?',
      options: [
        'Because x86 has no memory management unit',
        'Because on RISC all control- and behaviour-sensitive instructions are privileged, while x86 was not primarily designed to support virtualization',
        'Because x86 cannot run multiple processes',
        'Because RISC has no privileged instructions at all'
      ],
      answer: 1,
      explanation: 'A CPU architecture is virtualizable if it can run the VM\'s privileged and unprivileged instructions in user mode while the VMM runs in supervisor mode. On RISC, all control- and behaviour-sensitive instructions are privileged and therefore trap; x86 had sensitive but unprivileged instructions, which needed binary translation, paravirtualization or hardware-assisted virtualization to handle.'
    },
    {
      q: 'In memory virtualization, who maps what?',
      options: [
        'The guest OS maps machine memory to virtual memory',
        'The guest OS maps virtual addresses to guest physical addresses, and the VMM maps guest physical to machine memory',
        'The hypervisor alone maps virtual addresses straight to machine memory',
        'The CPU maps everything with no software involvement'
      ],
      answer: 1,
      explanation: 'A two-stage mapping replaces the one-stage page-table mapping of a traditional OS: the guest OS continues to control virtual-to-physical mapping for its own VM, and the VMM is responsible for mapping guest physical memory to actual machine memory. The MMU and TLB optimize the translation.'
    },
    {
      q: 'Which approach to I/O virtualization achieves close-to-native performance but has challenges with commodity devices?',
      options: [
        'Full device emulation',
        'Direct I/O virtualization',
        'Copy-on-write disks',
        'Storage virtualization'
      ],
      answer: 1,
      explanation: 'Direct I/O lets the VM access devices directly, avoiding the high CPU cost of emulation, but current implementations focus on networking for mainframes and there are challenges for commodity hardware — for example a reclaimed device may be left in an arbitrary state such as DMA to an arbitrary memory location, which can crash the system.'
    },
    {
      q: 'In Xen, which domain is privileged and allocates hardware resources for the guests?',
      options: [
        'Domain U',
        'Domain 0',
        'The virtual device domain',
        'The driver domain of each guest'
      ],
      answer: 1,
      explanation: 'Domain 0 is the privileged guest OS of Xen, loaded first when Xen boots without file-system drivers available; it is designed to access hardware directly and manage devices, allocating and mapping hardware resources for the Domain U guest domains.'
    },
    {
      q: 'Which is NOT a benefit of virtualization as listed in the deck?',
      options: [
        'Isolation of virtual machines as if they were physically separated',
        'Encapsulation of a complete computing environment',
        'Hardware independence and migration between hosts',
        'Removal of the need for an operating system in each virtual machine'
      ],
      answer: 3,
      explanation: 'The five benefits are sharing of resources for cost reduction, isolation, encapsulation, hardware independence and portability. Virtualization does not remove the need for an OS — a VM is an isolated runtime environment (guest OS and applications); it is containers that share one host kernel.'
    },
    {
      q: 'What is the key architectural difference between a container and a virtual machine?',
      options: [
        'Containers cannot run in the cloud',
        'Containers create isolated OS environments within the same host system kernel, so only binaries, libraries and runtime components are separate per container',
        'Containers emulate the hardware directly like a hypervisor',
        'Containers always include a full guest operating system'
      ],
      answer: 1,
      explanation: 'Containerization abstracts at the OS level and shares the host kernel through a container engine such as Docker, which makes containers more resource-efficient than VMs. The consequence is that all containers must run atop the same kernel, that they are less secure due to sharing the underlying OS (Meltdown), and that there is less flexibility about hardware.'
    },
    {
      q: 'Which is a stated disadvantage of containers?',
      options: [
        'They cannot be versioned',
        'All containers must run atop the same kernel, are less secure due to sharing the underlying OS, and are less flexible with respect to hardware',
        'They require a hypervisor',
        'They cannot run on bare-metal servers'
      ],
      answer: 1,
      explanation: 'The three cons are those. Their pros are compartmentalisation, portability (size, ease of defining a container, versioning), a great ecosystem, and using the host kernel for resource allocation. Containers can run on bare metal, on hypervisors, or in cloud infrastructure.'
    },
    {
      q: 'In the cloud reference architecture, which layer contains the hypervisors and turns physical resources into the pool the services are sold from?',
      options: [
        'Service layer',
        'Resource abstraction and control layer',
        'Physical resource layer',
        'Cloud service management'
      ],
      answer: 1,
      explanation: 'The provider stacks the service layer (SaaS, PaaS, IaaS) above the resource abstraction and control layer above the physical resource layer (hardware and facility), with cloud service management (business support, provisioning and configuration, portability and interoperability) alongside them.'
    },
    {
      q: 'Which NIST cloud actor conducts audits with the intent to express an opinion, verifying conformance to standards through objective evidence?',
      options: [
        'The broker',
        'The consumer',
        'The auditor',
        'The carrier'
      ],
      answer: 2,
      explanation: 'The auditor performs audits to verify conformance to standards through review of objective evidence. The broker manages use, performance and delivery of services and negotiates between providers and consumers, through intermediation, aggregation or arbitrage; the consumer is the principal stakeholder maintaining a business relationship with the provider.'
    },
    {
      q: 'Why is overprovisioning a problem for a cloud provider?',
      options: [
        'It breaks the SLA and incurs penalties',
        'It leads to resource underutilisation and consequently a decrease in revenue',
        'It increases heat dissipation beyond the facility limit only',
        'It is impossible with an autonomous system'
      ],
      answer: 1,
      explanation: 'The two-sided error: underprovisioning breaks SLAs and leads to penalties, while overprovisioning wastes resources and lowers revenue. That is why efficient provisioning is a commercial optimisation, made harder by unpredictable demand, failures, service heterogeneity, power management and conflicting SLAs.'
    },
    {
      q: 'Which provisioning method adds or removes instances based on the current utilisation of allocated resources?',
      options: [
        'Event-driven',
        'Popularity-driven',
        'Demand-driven',
        'Migration-driven'
      ],
      answer: 2,
      explanation: 'The demand-driven method uses thresholds — for example a CPU utilisation range of 30% to 70%, decreasing capacity below 30% and increasing it above 70% — and Amazon implements such an auto-scale feature in EC2. It is easy to implement but fails when the workload changes abruptly. The event-driven and popularity-driven methods are predictive.'
    },
    {
      q: 'For which situation is the event-driven provisioning method best suited?',
      options: [
        'A workload that changes abruptly with no pattern',
        'Seasonal or predicted events such as Christmastime or the Lunar New Year',
        'A steady state that never varies',
        'Applications that suddenly become popular on social media'
      ],
      answer: 1,
      explanation: 'Event-driven provisioning adds or removes instances based on a specific time event and anticipates peak traffic before it happens, working best for seasonal or predicted events; if the prediction is wrong, wasted resources are even greater. Sudden social-media popularity is the popularity-driven method\'s case.'
    }
  ],

  past: [
    {
      year: '2025 (expected)',
      marks: '8',
      repeats: 1,
      q: 'Explain the Cloud Reference Architecture with a suitable diagram.',
      occ: [
        { year: '2025 (expected)', marks: '8', q: 'Explain the Cloud Reference Architecture with a suitable diagram.' }
      ],
      answer: `
<h4>Model answer &mdash; 8 marks</h4>
<p>The reference architecture is a stack, and it is marked as a stack: describe it from the
bottom up and draw the layers beside the description.</p>
<ul>
<li><strong>Physical / infrastructure layer</strong> &mdash; servers, storage, network. The
provider's data-centre hardware; the customer never sees it. Everything above is virtualised
out of this.</li>
<li><strong>Virtualisation layer</strong> &mdash; the hypervisor and virtual network. It turns
the physical resources into a pool that can be partitioned into virtual machines on demand,
which is what makes <em>pooling</em> and <em>elasticity</em> possible.</li>
<li><strong>Resource provisioning and management layer</strong> &mdash; the scheduler and the
control plane. It decides which host a workload lands on, allocates and reclaims resources,
monitors usage and enforces the policies that metering and SLAs depend on.</li>
<li><strong>Service layer</strong> &mdash; the three service models as a stack: IaaS exposes the
VMs, PaaS adds the runtime and middleware, SaaS is the finished application.</li>
<li><strong>Access / user layer</strong> &mdash; the interfaces: web console, CLI, APIs. This is
where <em>on-demand self-service</em> is actually delivered.</li>
<li><strong>Cross-cutting: security, management and governance</strong> &mdash; not a layer but
a column through all of them: identity and access management, encryption, monitoring, billing,
compliance.</li>
</ul>
<p>Draw it as six horizontal bands with one vertical band down the side, and label the vertical
band as the cross-cutting concerns. The unit's diagram follows the NIST reference architecture
presented this way.</p>
<div class="concept-box tip">
<h4>Marking this one</h4>
<p>Predicted &mdash; the previous site lists it under “2025 Exam / Expected”, 8 marks,
and it says “with a suitable diagram”. That phrase is an instruction: an unlabelled
diagram earns little and a labelled stack with the cross-cutting column earns most of it. Name
the layer, then say what it does in one clause &mdash; that is a mark per layer.</p>
</div>
`
    },
    {
      year: '2025 (expected)',
      marks: '5',
      repeats: 1,
      q: 'Compare Virtual Machines and Containers.',
      occ: [
        { year: '2025 (expected)', marks: '5', q: 'Compare Virtual Machines and Containers.' }
      ],
      answer: `
<h4>Model answer &mdash; 5 marks</h4>
<p>The difference is <strong>where the boundary is drawn</strong>. A virtual machine virtualises
the <em>hardware</em>; a container virtualises the <em>operating system</em>.</p>
<table class="comparison-table">
<tr><th>Aspect</th><th>Virtual machine</th><th>Container</th></tr>
<tr><td>What is virtualised</td><td>The hardware, by a hypervisor</td><td>The host OS kernel, by a container engine</td></tr>
<tr><td>Guest OS</td><td>Each VM has its own full OS</td><td>None &mdash; containers share the host kernel</td></tr>
<tr><td>Size and boot</td><td>Gigabytes, tens of seconds</td><td>Megabytes, under a second</td></tr>
<tr><td>Isolation</td><td>Strong: a hardware boundary</td><td>Weaker: namespaces and cgroups, shared kernel</td></tr>
<tr><td>Density</td><td>Few per host</td><td>Many per host</td></tr>
<tr><td>Portability</td><td>Portable between hypervisors</td><td>Portable between hosts running a compatible kernel</td></tr>
</table>
<p>The one-sentence answer: a VM pays for strong isolation with a whole operating system per
workload, and a container drops that cost by sharing the kernel, which is why containers are
where microservices are usually deployed and VMs are where different operating systems and
untrusted tenants usually are.</p>
<div class="concept-box tip">
<h4>Marking this one</h4>
<p>Predicted &mdash; from the previous site's “2025 Exam / Expected” set, 5 marks. Say
what is virtualised first; every other difference follows from it, and an answer that lists
five differences without naming that one has the detail but not the structure.</p>
</div>
`
    },
    {
      year: 'Model 2025',
      marks: '2',
      repeats: 1,
      q: 'What is virtualization in cloud computing?',
      occ: [
        { year: 'Model 2025', marks: '2', q: 'What is virtualization in cloud computing?' }
      ],
      answer: `
<h4>Model answer &mdash; 2 marks</h4>
<p><strong>Virtualization is the ability to run multiple operating systems on a single physical system and share the underlying hardware resources.</strong> It is <strong>the process by which one computer hosts the appearance of many computers</strong>, and it is <strong>used to improve IT throughput and costs by using physical resources as a pool from which virtual resources can be allocated</strong>.</p>
<p>In cloud computing it is the foundation of the delivery models: a <strong>virtual machine (VM) is an isolated runtime environment &mdash; a guest OS and its applications &mdash; and multiple virtual systems can run on a single physical system</strong>, above a <strong>virtualization platform</strong> such as Xen, KVM or VMware. That is what makes <strong>elasticity</strong> (creating and destroying machines on demand), <strong>pay-per-usage</strong> (metering per virtual machine) and <strong>resource multiplexing</strong> (several guests sharing one box) possible &mdash; the properties from 5.2.1.</p>
<p><em>To extend to a longer answer:</em> add the six types &mdash; <strong>application, network, desktop, storage, server and data</strong> virtualization &mdash; and the five benefits: <strong>sharing of resources for cost reduction, isolation, encapsulation, hardware independence and portability</strong>.</p>

<div class="concept-box tip">
<h4>Where this came from</h4>
<p>Group A, question 4 of the <em>Model Question 2025</em> &mdash; 2 marks, so the definition plus one sentence on why the cloud needs it is a complete answer. Group A rewards the formal definition, so give it in the syllabus's own words before explaining.</p>
</div>`
    },
    {
      year: 'Model 2025',
      marks: '4',
      repeats: 2,
      q: 'Explain the difference between a hypervisor Type I and Type II.',
      occ: [
        { year: 'Model 2025', marks: '4', q: 'Explain the difference between a hypervisor Type I and Type II.' },
        { year: '2025 (expected)', marks: '6', q: 'Define Virtualization. Explain the role and types of Hypervisor.' }
      ],
      answer: `
<h4>Model answer &mdash; 4 marks</h4>
<p><strong>What a hypervisor is.</strong> A <strong>hypervisor</strong>, also called a virtual machine manager/monitor (VMM) or virtualization manager, is <strong>a program that allows multiple operating systems to share a single hardware host</strong>. Each guest operating system <strong>appears to have the host's processor, memory and other resources all to itself</strong>, while the hypervisor actually controls the host processor and resources, <strong>allocating what is needed to each operating system in turn and ensuring the guest operating systems cannot disrupt each other</strong>. It <strong>supports hardware-level virtualization on bare-metal devices such as CPU, memory, disk and network interfaces</strong>, <strong>sits directly between the physical hardware and its OS</strong>, and <strong>provides hypercalls to the guest OSes and applications</strong>. The two types differ in <strong>where that layer sits</strong>.</p>

<p><strong>Type I &mdash; native or bare-metal hypervisor.</strong></p>
<ul>
<li><strong>Runs directly on the underlying host system.</strong></li>
<li><strong>Does not require any base server operating system.</strong></li>
<li><strong>Has direct access to hardware resources</strong> &mdash; CPU, memory, disk and network interfaces.</li>
<li>Because there is no host OS in the path, performance is better and there is one fewer layer to compromise.</li>
<li><strong>Examples: Xen, KVM, VMware ESXi.</strong> <strong>Amazon EC2 uses Xen as its virtual machine monitor, and the same VMM is used in IBM's Blue Cloud.</strong></li>
</ul>

<p><strong>Type II &mdash; hosted hypervisor.</strong></p>
<ul>
<li><strong>Does not run directly over the underlying hardware; it runs as an application in a host system (physical machine).</strong></li>
<li>It therefore carries <strong>the host operating system layer above the hardware</strong>, and relies on that host OS for hardware access and device drivers.</li>
<li>It is the appropriate choice on desktops and for development, where the machine already has an OS and the user wants a second one.</li>
<li><strong>Examples: VMware Workstation, Oracle VirtualBox.</strong></li>
</ul>

<p><strong>The comparison in one line.</strong> A Type I hypervisor <strong>replaces</strong> the host operating system and runs on bare metal; a Type II hypervisor <strong>runs on top of</strong> the host operating system as an application. Data centres and cloud providers use Type I (Xen in EC2 and Blue Cloud, which is why EC2 can treat VMs as physical hosts and migrate them live); desktop users use Type II for convenience.</p>

<div class="concept-box tip">
<h4>Where this came from</h4>
<p>Group B, question 11 of the <em>Model Question 2025</em>, worth 4 marks. The question says <em>explain the difference</em>, so a two-column comparison is the fastest full-mark shape: where it runs, the alternative names, hardware access, typical use, examples. Open with the definition of a hypervisor &mdash; it is one sentence and it frames both types as answers to the same question (where does the virtualization layer sit?). Fig 6.1 shows the same thing as a diagram.</p>
</div>`
    }
  ]
};

;
/* ch7.js */
/* Chapter 7 — Cloud Platforms and Technologies.

   Syllabus unit 7: 4 hours, 6 marks. Sub-topics 7.1 Overview of AWS, Microsoft
   Azure and Google Cloud, 7.2 Storage services (S3, Blob, etc.), 7.3 Compute
   services (EC2, Lambda, GCE).

   Sourcing note, because it differs from the rest of this portal. The lecture
   folder contains NO dedicated deck for this unit — there is no "Chapter 7"
   file among the 24 sources read into `_source/dcc/`. Everything here is
   therefore drawn from:

     * the Chapter 5 and Chapter 6 decks, which name the platforms and the
       service models (Amazon EC2 on Xen, Google App Engine, Windows Azure,
       IBM Blue Cloud, VM templates)
     * `lecture_notes_all_chapterwise_ref_cloudcomptng.txt` — the 114-slide
       reference deck on cloud computing, which supplies the IaaS service list,
       the top-provider list, the IaaS advantages and disadvantages, the
       XaaS family and the pizza analogy
     * `books_all_ref_book1_distributed_and_cloud_computing_kaihwang.txt` —
       Kai Hwang's *Distributed and Cloud Computing*, the course's first
       reference, which covers EC2, S3, EBS and SimpleDB, Eucalyptus and the
       virtual-cluster material
     * the syllabus list itself: 7.1 Overview of AWS, Microsoft Azure and Google
       Cloud; 7.2 Storage services (S3, Blob, etc.); 7.3 Compute services
       (EC2, Lambda, GCE)

   Where a platform fact is not in those sources it is stated as the vendor's
   own published behaviour rather than as the teacher's wording, so the
   sourcing stays visible. If a Chapter 7 deck exists, uploading it will let
   this page be rewritten from class material. */

window.CHAPTERS = window.CHAPTERS || {};
window.CHAPTERS[7] = {
  learn: `

<h2>Unit 7 &mdash; Cloud Platforms and Technologies</h2>
<p class="unit-meta">Syllabus: 4 hours &middot; 6 marks &middot; sub-topics 7.1&ndash;7.3</p>

<div class="concept-box warn">
<h4>About this unit's sources</h4>
<p>Unlike every other unit in this portal, <strong>there is no Chapter 7 lecture deck in the folder that was shared</strong>. This page is written from the course's own Chapter 5 and 6 decks, from the 114-slide cloud-computing reference deck, and from Kai Hwang's <em>Distributed and Cloud Computing</em> (the syllabus's first reference book) &mdash; all of which are already in the portal's source set. Platform details that none of those cover are given as the vendors' own documented behaviour rather than as class material. <strong>If a Chapter 7 deck exists, upload it and this page can be rewritten from it.</strong></p>
</div>

<div class="concept-box asked">
<h4>What this unit is worth in the exam</h4>
<p>The Model Question 2025 has <strong>no question from this unit</strong>, and it is the only unit of which that is true. That does not make it optional: the syllabus weights it at <strong>6 marks</strong>, and its vocabulary is used inside the answers to other units' questions &mdash; Unit 5's IaaS question is easier to answer with EC2 named as the instance, and Unit 9's cloud-native question assumes containers and Kubernetes, which are compute services on these platforms. Learn it as the concrete half of Unit 5: <em>Unit 5 said what the models are; Unit 7 names who sells them and what they are called.</em></p>
</div>

<h2>7.1 Overview of AWS, Microsoft Azure and Google Cloud</h2>

<h3>7.1.1 What a cloud platform is</h3>
<p>From the course's own material, the providers are the actors in Unit 5's definitions: a <strong>cloud provider</strong> is a company offering computing services over the Internet and <strong>charging for them based on usage</strong>. The platform is the whole of what that provider offers &mdash; the three delivery models from 5.3 all in one catalogue.</p>

<p>The course's reference deck records the model as a market: the third layer of the cloud service stack is <strong>IaaS, provided by Amazon, Windows Azure and Rackspace among others</strong>, and the middle layer is <strong>PaaS, provided by Google, Salesforce.com and Facebook among others</strong>. Unit 5's deck names the same set from the service-model side &mdash; <strong>Amazon EC2 for IaaS, Google App Engine and Windows Azure for PaaS, Gmail and Salesforce for SaaS</strong> &mdash; and its public-cloud examples add <strong>IBM Cloud, Salesforce Heroku, Microsoft Azure and Google App Engine</strong>.</p>
<p>Every major platform is therefore best understood as <strong>the same three-layer catalogue</strong>, with the same three questions to ask of any of it: <em>what is rented</em> (IaaS, PaaS or SaaS), <em>where is it</em> (region and availability zone), and <em>how is it billed</em> (per hour, per second, per invocation, per gigabyte).</p>
<!-- dcc-fig:ch5/ref-cloudcomptng-s74-130.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s74-130.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 74" width="620" height="347" loading="lazy" decoding="async">
<figcaption><strong>slide 74</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>7.1.2 The three platforms</h3>
<table class="comparison-table">
<thead>
<tr><th></th><th>Amazon Web Services (AWS)</th><th>Microsoft Azure</th><th>Google Cloud</th></tr>
</thead>
<tbody>
<tr><td><strong>Position</strong></td><td>The first mover and the largest catalogue. <strong>Amazon EC2 is the course's canonical IaaS example</strong> and the platform the deck returns to: <strong>EC2 uses Xen as its virtual machine monitor, and the same VMM is used in IBM's Blue Cloud</strong>.</td><td><strong>Windows Azure is the course's other PaaS example</strong>, and the deck records that <strong>Microsoft also applies virtualization in its Azure cloud platform</strong>.</td><td><strong>Google App Engine is the course's PaaS example</strong>, and the deck's public-cloud list names <strong>Google App Engine</strong> among the popular providers.</td></tr>
<tr><td><strong>How it began</strong></td><td>As an IaaS platform: rent a virtual machine by the hour. The reference book describes the model precisely &mdash; <strong>EC2 is a good example of a web service that provides elastic computing power in a cloud, and it permits customers to create VMs and manage user accounts over the time of their use</strong>.</td><td>As a managed application platform and then expanded downwards into virtual machines and upwards into SaaS (Microsoft 365) &mdash; which is why the same platform appears as both a PaaS and an IaaS example in the course material.</td><td>As a managed application platform (App Engine), then expanded downwards into virtual machines and Kubernetes &mdash; the reverse of AWS's direction.</td></tr>
<tr><td><strong>Storage service</strong></td><td><strong>Amazon S3</strong> (object storage), with <strong>EBS</strong> (Elastic Block Store) and <strong>SimpleDB</strong> named alongside it in the reference book.</td><td><strong>Azure Blob Storage</strong> for objects, with Azure Files and managed disks for file and block storage.</td><td><strong>Cloud Storage</strong> for objects, with Persistent Disk for block storage.</td></tr>
<tr><td><strong>Compute service</strong></td><td><strong>EC2</strong> for virtual machines; <strong>Lambda</strong> for serverless functions; containers on ECS/EKS.</td><td><strong>Virtual Machines</strong> for IaaS; <strong>Azure Functions</strong> for serverless; <strong>AKS</strong> for Kubernetes.</td><td><strong>Compute Engine (GCE)</strong> for virtual machines; <strong>Cloud Functions</strong> for serverless; <strong>GKE</strong> for Kubernetes.</td></tr>
<tr><td><strong>The pattern to notice</strong></td><td colspan="3">All three <strong>converged</strong>: each now offers virtual machines, containers, serverless functions, managed databases and object storage. Choosing between them is therefore not about which model they offer &mdash; they all offer all three &mdash; but about geography, price, ecosystem, tooling and whether the workload is already written for one of them.</td></tr>
</tbody>
</table>

<h3>7.1.3 What an IaaS provider actually supplies</h3>
<p>The course's reference deck answers this directly, and it is the best "list the services of a cloud platform" answer available:</p>
<table class="comparison-table">
<thead>
<tr><th>Service</th><th>What it provides</th></tr>
</thead>
<tbody>
<tr><td><strong>Compute</strong></td><td><strong>Computing as a Service includes virtual central processing units and virtual main memory for the VMs that are provisioned to the end users.</strong></td></tr>
<tr><td><strong>Storage</strong></td><td><strong>The IaaS provider provides back-end storage for storing files.</strong></td></tr>
<tr><td><strong>Network</strong></td><td><strong>Network as a Service (NaaS) provides networking components such as routers, switches and bridges for the VMs.</strong></td></tr>
<tr><td><strong>Load balancers</strong></td><td><strong>It provides load balancing capability at the infrastructure layer.</strong></td></tr>
</tbody>
</table>

<p>Two further notes from the same source. The <strong>top IaaS providers</strong> it lists are <strong>Amazon Web Services, Rackspace, Netmagic Solutions, Tata Communications, Sify Technologies and Reliance</strong> &mdash; useful for a "name the providers" question, and a reminder that the market is not only the three American platforms. And the provider is not always the same kind of company: the reference book's own case studies include <strong>IBM's Ensemble</strong>, which <strong>offers a virtualized cloud system for IaaS services, putting together a large resource pool to simplify management complexity</strong>, with <strong>Tivoli Service Automation Manager for rapid design, deployment and management of service processes</strong> and <strong>WebSphere CloudBurst</strong> as another management platform.</p>
<!-- dcc-fig:ch5/ref-cloudcomptng-s56-125.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s56-125.webp" alt="Top Iaas Providers who are providing IaaS cloud computing platform" width="660" height="421" loading="lazy" decoding="async">
<figcaption><strong>slide 56</strong> &middot; Ref_CloudComptng.pptx &mdash; Top Iaas Providers who are providing IaaS cloud computing platform</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>7.1.4 The advantages and disadvantages of the IaaS layer</h3>
<p>These are the reference deck's list, and they are useful because they are the customer's view of a rented platform:</p>
<table class="comparison-table">
<thead>
<tr><th>Advantages</th><th>What it means</th></tr>
</thead>
<tbody>
<tr><td><strong>Shared infrastructure</strong></td><td><strong>IaaS allows multiple users to share the same physical infrastructure.</strong></td></tr>
<tr><td><strong>Web access to the resources</strong></td><td><strong>IaaS allows IT users to access resources over the internet.</strong></td></tr>
<tr><td><strong>Pay-as-per-use model</strong></td><td><strong>Providers offer services on a pay-as-per-use basis; users are required to pay for what they have used.</strong></td></tr>
<tr><td><strong>Focus on the core business</strong></td><td><strong>IaaS providers focus on the organisation's core business rather than on IT infrastructure</strong> &mdash; the customer does.</td></tr>
<tr><td><strong>On-demand scalability</strong></td><td><strong>Users do not have to worry about upgrading software or troubleshooting hardware components.</strong></td></tr>
</tbody>
</table>
<!-- dcc-fig:ch5/ref-cloudcomptng-s111-148.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s111-148.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 111" width="1210" height="1303" loading="lazy" decoding="async">
<figcaption><strong>slide 111</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<table class="comparison-table">
<thead>
<tr><th>Disadvantages</th><th>What it means</th></tr>
</thead>
<tbody>
<tr><td><strong>Security</strong></td><td><strong>Security is one of the biggest issues in IaaS &mdash; most providers are not able to provide 100% security.</strong></td></tr>
<tr><td><strong>Maintenance and upgrade</strong></td><td><strong>Although IaaS service providers maintain the software, they do not upgrade the software for some organisations.</strong></td></tr>
<tr><td><strong>Interoperability issues</strong></td><td><strong>It is difficult to migrate a VM from one IaaS provider to another, so customers might face problems related to vendor lock-in.</strong></td></tr>
</tbody>
</table>

<div class="concept-box key">
<h4>Why that third disadvantage is the important one</h4>
<p><strong>"It is difficult to migrate a VM from one IaaS provider to the other, so the customers might face problem related to vendor lock-in."</strong> This is the same vendor lock-in as Unit 5's challenge list, but now with the mechanism attached: the difficulty of moving a <em>virtual machine</em> between providers. It also explains why the reference architecture in Unit 6 includes a <strong>portability/interoperability</strong> management function, and why the industry converged on <strong>containers and Kubernetes</strong> &mdash; an image that runs anywhere is, among other things, a lock-in remedy. That is the bridge from this unit to Unit 9.</p>
</div>

<h3>7.1.5 The pizza analogy, which makes the three models concrete</h3>
<p>The reference deck's slide 57 draws the delivery models as four ways of getting pizza, and it is the fastest way to explain IaaS, PaaS and SaaS to anyone &mdash; including an examiner who has read the same slide:</p>
<!-- dcc-fig:ch5/ref-cloudcomptng-s68-129.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s68-129.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 68" width="1041" height="561" loading="lazy" decoding="async">
<figcaption><strong>slide 68</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<table class="comparison-table">
<thead>
<tr><th>Model</th><th>The analogy</th><th>Who manages what</th></tr>
</thead>
<tbody>
<tr><td><strong>On-premises</strong></td><td><strong>Dined in at home</strong>: dining table, electric or gas oven, fire, pizza dough, tomato sauce, toppings, cheese &mdash; all made and provided by you.</td><td>You manage everything: infrastructure, platform and software.</td></tr>
<tr><td><strong>IaaS</strong></td><td><strong>Take and bake</strong>: the vendor delivers the dough, sauce, toppings and cheese; you supply the table, oven and fire.</td><td><strong>You manage</strong> the operating system, runtime and application; the vendor manages the virtual infrastructure.</td></tr>
<tr><td><strong>PaaS</strong></td><td><strong>Pizza delivered</strong>: the vendor brings the finished pizza and the oven work is done; you provide the table and the drinks.</td><td>The vendor manages infrastructure <em>and</em> platform; you manage only the application and its configuration.</td></tr>
<tr><td><strong>SaaS</strong></td><td><strong>Dined out</strong>: everything is the restaurant's; you order and eat.</td><td>The vendor manages everything; you manage only your data and your account.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch5/ref-cloudcomptng-s57-126.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s57-126.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 57" width="619" height="517" loading="lazy" decoding="async">
<figcaption><strong>slide 57</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch5/ref-cloudcomptng-s66-128.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s66-128.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 66" width="1142" height="542" loading="lazy" decoding="async">
<figcaption><strong>slide 66</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>Unit 5's service-model definitions say the same thing in formal language &mdash; the customer of IaaS "can deploy and run arbitrary software, including operating systems", the customer of PaaS "does not manage or control the underlying cloud infrastructure, including network, servers, operating systems or storage". The pizza table is the version to draw if a question says "explain with an analogy".</p>
<!-- dcc-fig:ch5/ref-cloudcomptng-s77-131.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s77-131.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 77" width="400" height="400" loading="lazy" decoding="async">
<figcaption><strong>slide 77</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>7.1.6 The wider family: XaaS</h3>
<p>The reference deck generalises the three models into <strong>XaaS &mdash; Anything as a Service, or Everything-as-a-Service</strong>: <strong>a general collective term that refers to the delivery of anything as a service, recognising the vast number of products, tools and technologies vendors now deliver to users as a service over a network &mdash; typically the internet &mdash; rather than providing them locally or on-site within an enterprise</strong>. <strong>The most common examples are the three general cloud computing models: SaaS, PaaS and IaaS</strong>, but the deck lists many more, and naming three or four of them is a cheap way to show breadth:</p>
<table class="comparison-table">
<thead>
<tr><th>Term</th><th>What is delivered</th></tr>
</thead>
<tbody>
<tr><td><strong>HaaS</strong> &mdash; Hardware as a Service</td><td><strong>Managed service providers own hardware and install it at customers' sites on demand</strong>, and customers use it under SLAs. <strong>This pay-as-you-go model is similar to leasing</strong> and is comparable to IaaS when the computing resources sit at the provider's site as virtual equivalents of physical hardware. <strong>Especially cost-effective for small or mid-sized businesses.</strong></td></tr>
<tr><td><strong>CaaS</strong> &mdash; Communication as a Service</td><td><strong>Communication solutions such as VoIP, instant messaging and video conferencing hosted in the vendor's cloud</strong>, deployed selectively for the period needed and paid for over that period only.</td></tr>
<tr><td><strong>DaaS</strong> &mdash; Desktop as a Service</td><td><strong>Desktops delivered as virtual services along with the apps needed</strong>, so a client works on a personal computer using third-party server capacity. <strong>The provider is typically responsible for storing, securing and backing up user data and for delivering upgrades to all supported desktop apps</strong> &mdash; the cloud-scale version of the desktop virtualization in Unit 6.</td></tr>
<tr><td><strong>SECaaS</strong> &mdash; Security as a Service</td><td><strong>Outsourced security management</strong>: the provider integrates its security services into your infrastructure and delivers them over the Internet &mdash; <strong>anti-virus, encryption, authentication, intrusion detection</strong> and more.</td></tr>
<tr><td><strong>DBaaS</strong> &mdash; Database as a Service</td><td><strong>Provides access to a database platform through the cloud; public cloud providers like AWS and Azure have DBaaS offerings.</strong></td></tr>
<tr><td><strong>TaaS</strong> &mdash; Transportation as a Service</td><td><strong>Transport applications delivered as a service</strong> &mdash; car sharing and ride-hailing via an app, paying for time used or distance covered.</td></tr>
<tr><td><strong>Also named</strong></td><td><strong>HaaS (Healthcare as a Service), MaaS, NaaS, STaaS, DRaaS, DaaS and more</strong> &mdash; the deck's own diagram collects a dozen of the abbreviations. Some letters are reused with different meanings (HaaS is both Hardware and Healthcare), so always write the full name.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch5/ref-cloudcomptng-s95-146.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s95-146.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 95" width="704" height="513" loading="lazy" decoding="async">
<figcaption><strong>slide 95</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch5/ref-cloudcomptng-s108-147.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s108-147.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 108" width="1210" height="1316" loading="lazy" decoding="async">
<figcaption><strong>slide 108</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p><strong>Benefits of XaaS</strong>, as the reference deck lists them: <strong>scalability</strong> (outsourcing gives access to effectively unlimited computing capacity, and a company can scale processes up and down without worrying about deployments or downtime); <strong>cost- and time-effectiveness</strong> (no equipment to buy or deploy, and a pay-as-you-go model); <strong>focus on core competencies</strong> (no need to set up applications or train staff on them); <strong>high quality of services</strong> (professionals maintain the infrastructure and provide the latest updates); and <strong>better customer experience</strong> as a consequence.</p>
<h2>7.2 Storage services</h2>

<h3>7.2.1 The three shapes of cloud storage</h3>
<p>The unit names S3 and Blob, and both are <em>object</em> storage &mdash; but a platform offers three different shapes, and an exam answer that distinguishes them is stronger than one that does not:</p>

<table class="comparison-table">
<thead>
<tr><th></th><th>Object storage</th><th>Block storage</th><th>File storage</th></tr>
</thead>
<tbody>
<tr><td><strong>What it stores</strong></td><td><strong>Objects</strong> in a flat namespace, each addressed by a key, with metadata alongside the bytes.</td><td><strong>Volumes</strong> &mdash; raw blocks attached to a virtual machine, which the guest OS formats with a file system.</td><td><strong>Files</strong> in directories, reachable by many machines at once over a network protocol.</td></tr>
<tr><td><strong>How it is used</strong></td><td>Through an HTTP API: PUT an object, GET an object. No file system, no mounting.</td><td>Attached to an instance, then used exactly like a disk.</td><td>Mounted as a shared directory by several instances.</td></tr>
<tr><td><strong>AWS</strong></td><td><strong>Amazon S3</strong> (Simple Storage Service) &mdash; buckets containing objects.</td><td><strong>Amazon EBS</strong> (Elastic Block Store), named in the course's reference book alongside EC2, S3 and SimpleDB.</td><td>Amazon EFS (Elastic File System).</td></tr>
<tr><td><strong>Azure</strong></td><td><strong>Blob Storage</strong>: containers holding blobs, with block blobs, append blobs and page blobs as the three blob types.</td><td>Managed Disks.</td><td>Azure Files.</td></tr>
<tr><td><strong>Google Cloud</strong></td><td>Cloud Storage: buckets containing objects.</td><td>Persistent Disk.</td><td>Filestore.</td></tr>
<tr><td><strong>Use it for</strong></td><td>Backups, static website assets, images and video, logs, data-lake inputs for analytics &mdash; anything written once and read many times.</td><td>The boot disk and working data of a virtual machine.</td><td>Shared data between several machines that all need the same files.</td></tr>
</tbody>
</table>
<h3>7.2.2 How object storage is actually shaped</h3>
<p>The examinable facts about S3 and Blob are the same facts, so learn them once:</p>
<ul>
<li><strong>A bucket (S3) or container (Blob) is the top-level namespace.</strong> It holds objects, and it is the unit of policy, region and (in S3) globally unique naming.</li>
<li><strong>An object is addressed by key </strong>&mdash; the full path-like name &mdash; <strong>within</strong> its bucket, with the object's data and its metadata. There are no real directories; a "/" in a key is only a convention the console displays as folders.</li>
<li><strong>The API is HTTP verbs on a URL</strong>, which is why object storage needs no driver and works from any language: this is the <em>REST</em> style from Unit 2.4 used as the storage interface.</li>
<li><strong>Operations are PUT, GET, DELETE (and copy), not open/read/write/seek.</strong> An object is replaced whole, so object storage suits <strong>write-once, read-many</strong> data &mdash; exactly the GFS/HDFS access pattern from Unit 4.2.9, and for the same reason.</li>
<li><strong>Durability comes from replication across machines, and is quoted separately from availability.</strong> AWS documents S3 as designed for <strong>99.999999999% (eleven nines) durability</strong> for objects in standard storage; durability is the probability the data survives, availability is the probability you can reach it right now. Expect questions to use the terms interchangeably; define the difference.</li>
<li><strong>Access tiers trade retrieval latency and cost against storage cost.</strong> S3 offers standard, infrequent-access, one-zone-infrequent-access, Glacier and Deep Archive classes; Azure offers hot, cool and archive tiers. The rule is the same everywhere: <strong>cheaper to keep, dearer or slower to fetch</strong>. Lifecycle rules move objects between tiers automatically as they age.</li>
<li><strong>Versioning and replication are separate features:</strong> versioning keeps every overwritten version of an object (which is what makes accidental deletion recoverable), and cross-region replication copies buckets to another region for disaster recovery &mdash; the <strong>DRaaS</strong> entry in the XaaS list.</li>
</ul>

<div class="concept-box tip">
<h4>Storage virtualization, one unit later</h4>
<p>Unit 6.1.2 defined <strong>storage virtualization</strong> as aggregating physical storage <strong>into what appears to be a single storage device &mdash; or a pool of available storage capacity &mdash; managed from a central console</strong>, with <strong>servers not aware of exactly where their data is stored</strong>, functioning "more like worker bees in a hive". Object storage is that idea taken to the API level: the bucket is the pool, the key is the address, and the client never learns or cares which physical disks hold its bytes. If a question connects the two units, that is the sentence.</p>
</div>

<h3>7.2.3 Databases as a service</h3>
<p>Storage also arrives managed, and DBaaS is the case the reference deck names: <strong>Database as a Service provides access to a database platform through the cloud, and public cloud providers like AWS and Azure have DBaaS offerings</strong>. The distinction worth writing down is <em>who administers the database</em>. A database <em>on</em> a rented virtual machine is IaaS with your own DBMS on top: you size it, patch it, back it up and run its replicas. A managed database service keeps the platform and removes the administration, and the course's own textbook spells out exactly what that covers for AWS's <strong>SimpleDB</strong> &mdash; it <strong>automatically manages infrastructure provisioning, hardware and software maintenance, replication and indexing of data items, and performance tuning</strong>.</p>

<p>So the exam-safe definition has two halves: <strong>a database platform delivered as a service</strong>, and <strong>the operational work transferred to the provider</strong>. The book also names the other half of the same shift: SimpleDB is <strong>a nonrelational data store that stores and queries data items via Web services requests, supporting store-and-query functions traditionally provided only by relational databases</strong>, with <strong>multiple geographically distributed copies of each data item</strong>. That is why the service is reachable over the <em>REST</em> interface from Unit 2.4 rather than a database driver, exactly as object storage was.</p>

<table class="comparison-table">
<thead>
<tr><th></th><th>Database on IaaS (self-managed)</th><th>Managed database service (DBaaS)</th></tr>
</thead>
<tbody>
<tr><td><strong>You get</strong></td><td>A virtual machine and a blank operating system.</td><td>A running database endpoint, a connection string and a console.</td></tr>
<tr><td><strong>You do</strong></td><td>Install and patch the DBMS, size the storage, configure replication, schedule backups, test restores, tune queries, plan failover.</td><td>Model your schema and write your queries. Provisioning, patching, backup, replication, indexing and tuning are the provider's.</td></tr>
<tr><td><strong>Scaling</strong></td><td>Resize the instance and rebuild replicas yourself.</td><td>Change a tier, or add read replicas, from the console or an API.</td></tr>
<tr><td><strong>Course examples</strong></td><td>MySQL or PostgreSQL you install on EC2.</td><td><strong>SimpleDB</strong> (AWS's own list, alongside S3 and EBS); <strong>Bigtable</strong>, Google's wide-column store, from Unit 4's reading; Azure SQL and Cosmos DB on the Azure side.</td></tr>
</tbody>
</table>

<p>Two families sit under DBaaS and a question may ask you to place a service in one: <strong>relational</strong> (SQL, schemas, transactions, joins &mdash; right when correctness across several records matters) and <strong>non-relational or NoSQL</strong> (key-value, document, wide-column, graph &mdash; right when scale and a flexible shape matter more than joins). SimpleDB and Bigtable are both in the second family, which is the trend the textbook describes when it talks about <strong>the shift from traditional relational database systems to stores built for online transaction processing at network scale</strong>.</p>

<div class="concept-box tip">
<h4>One abbreviation, two meanings &mdash; and one boundary that moves</h4>
<p><strong>DaaS</strong> is the trap. In the reference deck it is <strong>Desktop-as-a-Service</strong>, a virtual desktop with its apps delivered from the provider's servers. In the course's other reference book the same letters appear as <strong>Data as a Service</strong>. Write the full name in any answer. The second thing to carry forward is that DBaaS moves the <em>database</em> from "your responsibility" to "the provider's" &mdash; which is precisely the boundary Unit 8.3 puts an SLA around and Unit 8.1 splits with the shared responsibility model. When a managed service is breached through a misconfigured access policy, the provider was secure and the customer was not: the service was managed, the data was not.</p>
</div>
<h2>7.3 Compute services</h2>

<h3>7.3.1 The three shapes of compute</h3>
<p>Compute services come in three shapes, and they differ in <strong>how much of the stack you manage</strong> &mdash; which is the same axis as Unit 6's VM-versus-container comparison, extended one step further to functions:</p>

<table class="comparison-table">
<thead>
<tr><th></th><th>Virtual machines (IaaS)</th><th>Containers</th><th>Serverless functions</th></tr>
</thead>
<tbody>
<tr><td><strong>AWS / Azure / Google</strong></td><td><strong>EC2</strong> / Virtual Machines / <strong>Compute Engine (GCE)</strong></td><td>ECS and EKS / AKS / GKE</td><td><strong>Lambda</strong> / Azure Functions / Cloud Functions</td></tr>
<tr><td><strong>You manage</strong></td><td>The guest OS, patches, runtime, application, scaling.</td><td>The container image and the orchestration configuration.</td><td><strong>Only the function's code</strong> and its configuration.</td></tr>
<tr><td><strong>Started by</strong></td><td>You boot it, and it stays up (and bills) until you stop it.</td><td>The orchestrator schedules it; it stays up while needed.</td><td><strong>An event</strong> &mdash; an HTTP request, a file arriving in storage, a queue message, a schedule.</td></tr>
<tr><td><strong>Billing</strong></td><td>Per hour or per second of instance time, whether or not it is busy.</td><td>For the nodes running the containers (or per-container in some managed offerings).</td><td><strong>Per invocation and per unit of execution time</strong>, with a free tier &mdash; nothing runs, nothing is charged.</td></tr>
<tr><td><strong>Scaling</strong></td><td>Manual or auto-scaling groups, driven by metrics.</td><td>The orchestrator adds or removes container replicas.</td><td><strong>Automatic and per request</strong>; the platform runs as many copies as are needed.</td></tr>
<tr><td><strong>Best for</strong></td><td>Long-running services, anything needing a specific OS or kernel, licensed software, and workloads with a steady load (where a reserved instance is cheapest).</td><td>Many copies of one stack, rapid deployment, portability between clouds.</td><td>Short, event-driven, spiky work: glue between services, image thumbnailing, scheduled jobs, webhooks.</td></tr>
<tr><td><strong>Worst for</strong></td><td>Variable or intermittent load &mdash; you pay for idle hours.</td><td>Workloads needing different kernels or strong isolation between tenants.</td><td>Long-running or stateful processes, and anything with a cold-start latency problem.</td></tr>
</tbody>
</table>

<figure class="figure-wide figure-wrap">
<svg class="figure wide" viewBox="0 0 790 300" role="img" aria-label="Three compute models side by side showing how much of the stack the customer manages: with virtual machines the customer manages everything above the hypervisor; with containers the customer manages the application and image; with serverless functions the customer manages only the code">
<defs><marker id="f7a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="flow-arrow-head"/></marker></defs>

<text class="flow-label" x="140" y="26" text-anchor="middle">Virtual machine</text>
<text class="flow-label" x="395" y="26" text-anchor="middle">Container</text>
<text class="flow-label" x="650" y="26" text-anchor="middle">Serverless function</text>

<rect class="flow-box phase1" x="40" y="44" width="200" height="34" rx="8"/><text class="flow-label" x="140" y="66" text-anchor="middle">Application</text>
<rect class="flow-box phase1" x="40" y="84" width="200" height="34" rx="8"/><text class="flow-label" x="140" y="106" text-anchor="middle">Runtime and libraries</text>
<rect class="flow-box phase1" x="40" y="124" width="200" height="34" rx="8"/><text class="flow-label" x="140" y="146" text-anchor="middle">Guest operating system</text>
<rect class="flow-box phase2" x="40" y="164" width="200" height="34" rx="8"/><text class="flow-label" x="140" y="186" text-anchor="middle">Hypervisor &mdash; provider</text>
<rect class="flow-box phase4" x="40" y="204" width="200" height="34" rx="8"/><text class="flow-label" x="140" y="226" text-anchor="middle">Hardware &mdash; provider</text>

<rect class="flow-box phase1" x="295" y="84" width="200" height="34" rx="8"/><text class="flow-label" x="395" y="106" text-anchor="middle">Application</text>
<rect class="flow-box phase1" x="295" y="124" width="200" height="34" rx="8"/><text class="flow-label" x="395" y="146" text-anchor="middle">Image: code, deps, config</text>
<rect class="flow-box phase2" x="295" y="164" width="200" height="34" rx="8"/><text class="flow-label" x="395" y="186" text-anchor="middle">Container engine &mdash; provider</text>
<rect class="flow-box phase4" x="295" y="204" width="200" height="34" rx="8"/><text class="flow-label" x="395" y="226" text-anchor="middle">Host OS and hardware</text>

<rect class="flow-box phase1" x="550" y="124" width="200" height="34" rx="8"/><text class="flow-label" x="650" y="146" text-anchor="middle">Function code</text>
<rect class="flow-box phase2" x="550" y="164" width="200" height="34" rx="8"/><text class="flow-label" x="650" y="186" text-anchor="middle">Everything else: the platform</text>
<rect class="flow-box phase4" x="550" y="204" width="200" height="34" rx="8"/><text class="flow-label" x="650" y="226" text-anchor="middle">executes it on demand</text>

<path class="flow-arrow" d="M244,120 H291" marker-end="url(#f7a)"/>
<path class="flow-arrow" d="M499,150 H546" marker-end="url(#f7a)"/>
<text class="flow-label" x="270" y="272" text-anchor="middle">less to manage</text>
<text class="flow-label" x="525" y="272" text-anchor="middle">less to manage</text>
<text class="flow-label" x="395" y="292" text-anchor="middle">Each step to the right removes a layer the customer patches, scales and pays for &mdash; and removes a layer the customer controls.</text>
</svg>
<figcaption><strong>Fig 7.1 &mdash; The three compute models by layers managed.</strong> A virtual machine is Unit 6.2's guest OS with everything above it; a container is the same application with the OS replaced by a shared kernel; serverless is the application alone, with the platform starting and stopping it per event. The trade is control for convenience, exactly as in the container comparison.</figcaption>
</figure>

<h3>7.3.2 EC2 &mdash; the virtual machine service</h3>
<p>The course's reference book gives the definition worth quoting: <strong>Amazon's Elastic Compute Cloud (EC2) is a good example of a web service that provides elastic computing power in a cloud, and EC2 permits customers to create VMs and to manage user accounts over the time of their use.</strong> The Unit 6 deck adds the implementation detail: <strong>EC2 uses Xen as the virtual machine monitor, and the same VMM is used in IBM's Blue Cloud</strong>; in EC2 <strong>some predefined VM templates are also provided, and users can choose different kinds of VMs from the templates</strong> (an <em>image</em> &mdash; an Amazon Machine Image &mdash; is that template), whereas <strong>IBM's Blue Cloud does not provide any VM templates</strong>, since <strong>in general any type of VM can run on top of Xen</strong>.</p>

<p>The vocabulary to know, all of it documented behaviour rather than class material:</p>
<ul>
<li><strong>Instance</strong> &mdash; one running virtual machine; <strong>instance type</strong> &mdash; its CPU, memory and network profile (families optimized for compute, memory, storage or GPU).</li>
<li><strong>AMI (image)</strong> &mdash; the template an instance is launched from; the deck's "VM templates".</li>
<li><strong>Security group</strong> &mdash; the firewall rules around an instance; this is Unit 8's IAM/access-control material in practice.</li>
<li><strong>Elastic IP, VPC, load balancer</strong> &mdash; the network services from 7.1.3: addresses, an isolated virtual network, and the load balancer at the infrastructure layer.</li>
<li><strong>Purchasing models</strong> &mdash; on-demand (per second, no commitment), reserved (a one- or three-year commitment for a large discount, right for steady load) and spot (spare capacity at a deep discount, reclaimable by the provider &mdash; the cloud version of the "interruptible" work in 6.4). Google's equivalent of spot instances is <strong>preemptible VMs</strong>.</li>
<li><strong>Auto-scaling</strong> &mdash; the demand-driven provisioning of 6.4.3 implemented as a service: <strong>Amazon implements such an auto-scale feature in its EC2 platform.</strong></li>
</ul>

<h3>7.3.3 Lambda &mdash; the serverless service</h3>
<p><strong>Serverless</strong> is the name for the model in which the provider runs the code and the customer does not manage, size or pay for servers at all. AWS Lambda is the canonical example, and the examinable properties are these:</p>
<ul>
<li><strong>An event starts the code and it ends when the function returns.</strong> There is no server to boot, so nothing bills while the function is not running &mdash; which is why the billing unit is <strong>invocations and execution duration</strong> rather than time.</li>
<li><strong>Scaling is per request and automatic.</strong> Each invocation is independent, so the platform runs as many concurrent copies as the incoming traffic needs &mdash; the extreme end of elasticity from 5.2.1.</li>
<li><strong>Functions are stateless between invocations.</strong> State belongs in storage or a database, which is why serverless designs lean on the object storage and managed databases of 7.2.</li>
<li><strong>The trade is the same as ever, pushed further:</strong> you control less. There is no OS to configure (and none to tune), execution time is capped, and a burst of cold starts can add latency to the first request after idle.</li>
<li><strong>The comparison to the other two models</strong> is what a question will ask for: a virtual machine is elastic capacity you keep running, a container is a packaged application the orchestrator schedules, and a function is a piece of code the platform invokes.</li>
</ul>

<h3>7.3.4 GCE, and why the three platforms look alike</h3>
<p><strong>Google Compute Engine (GCE)</strong> is Google's virtual machine service and the direct counterpart of EC2 and Azure Virtual Machines: instances from images, attached persistent disks, a virtual network with firewall rules, load balancing, and per-second billing with sustained-use discounts and preemptible VMs for interruptible work. Its distinguishing feature in practice is not the instance model but the ecosystem around it &mdash; the same Kubernetes origins (Google built and open-sourced Kubernetes, which is Unit 9.3) and the data and ML services that sit on top.</p>

<p>The reason all three platforms converge on the same catalogue is worth stating in an answer, because it is a consequence of Unit 3's lesson rather than a marketing fact: <strong>the services are APIs, and an API that is widely used becomes a de facto standard</strong>. Object storage's API shape, virtual machines with images and disks, containers with an orchestrator, functions invoked by events &mdash; once one provider defines a useful interface, the others must offer an equivalent or lose the customer's application. That is also what makes the portability problem in 7.1.4 partial rather than total: the <em>concepts</em> transfer, and it is the management APIs, identity model, billing and proprietary services that do not.</p>

<h3>7.3.5 Managing a platform, and the unit's real exam value</h3>
<p>A platform is used through a <strong>console, an API, a CLI and SDKs</strong>, and it is organised by <strong>region</strong> (a geographic area) and <strong>availability zone</strong> (an isolated set of data centres within it) &mdash; which is a fault-domain decision from Unit 1's independent-failures characteristic, applied as a design rule: place replicas across zones so that one zone's failure is survivable. The provider's own requirements are the reference architecture of 6.3 &mdash; orchestration, resource abstraction and control, physical resources, and the management functions &mdash; and the course's reference book lists the design goals behind a cloud platform's software stack: developers must design for <strong>high throughput, high availability and fault tolerance</strong>, and the layers are stacked so that each provides an interface to the one above.</p>

<div class="concept-box tip">
<h4>How to use this unit in answers for other units</h4>
<p>Unit 7 supplies the <em>concrete names</em> that make other units' answers read as though they were studied rather than memorised. Unit 5 (IaaS versus PaaS): IaaS is EC2, PaaS is Google App Engine or Windows Azure. Unit 6 (hypervisor types): Xen is the Type I hypervisor behind EC2 and IBM Blue Cloud. Unit 6 (provisioning): EC2 auto-scaling is the demand-driven method with its 30&ndash;70% CPU rule. Unit 9 (cloud-native): GKE, EKS and AKS are the managed Kubernetes services, and Lambda is the serverless example. Unit 8 (security): the security group is where IAM is enforced on an instance. Naming one platform per concept costs a few words and shows the syllabus was understood as a whole.</p>
</div>

<div class="concept-box tip">
<h4>The paper-facing part of this unit</h4>
<p>Everything in this unit that is written to be answered in the exam &mdash; what each question asks for, and the model answer to it &mdash; is collected in <a href="#/ch/7/past">Past Questions</a>. Read this tab for the subject; switch to that one when you sit down to answer a question.</p>
</div>
`,

  pastSummary: `<h2>Exam-facing summary</h2>
<table class="comparison-table">
<thead>
<tr><th>If the question says&hellip;</th><th>Give&hellip;</th></tr>
</thead>
<tbody>
<tr><td>Give an overview of AWS, Azure and Google Cloud</td><td>AWS began as IaaS (EC2, S3, EBS, SimpleDB named in Hwang) and is the course's IaaS example; Azure is the course's PaaS example (Windows Azure) and uses virtualization; Google Cloud is the other PaaS example (App Engine) and now also offers Compute Engine. All three converged on the same catalogue &mdash; virtual machines, containers, serverless, managed databases, object storage &mdash; and differ by geography, pricing, ecosystem and lock-in rather than by model.</td></tr>
<tr><td>Describe the services an IaaS provider offers</td><td>Compute (virtual CPUs and virtual main memory for VMs), storage (back-end storage for files), network (NaaS: routers, switches, bridges for the VMs) and load balancing at the infrastructure layer.</td></tr>
<tr><td>Advantages and disadvantages of IaaS</td><td>Advantages: shared infrastructure, web access to resources, pay-as-per-use, focus on the core business, on-demand scalability. Disadvantages: security, maintenance and upgrade, and interoperability issues causing vendor lock-in.</td></tr>
<tr><td>Explain the cloud service models with an analogy</td><td>The pizza table in 7.1.5 &mdash; on-premises as dining in at home, IaaS as take-and-bake, PaaS as pizza delivered, SaaS as dining out.</td></tr>
<tr><td>What is XaaS?</td><td>Anything/Everything as a Service: the collective term for delivering products, tools and technologies to users as a service over a network rather than locally; the three common models are SaaS, PaaS and IaaS, with HaaS, CaaS, DaaS, SECaaS, DBaaS and TaaS as further members &mdash; and the listed benefits of scalability, cost- and time-effectiveness, focus on core competencies, service quality and customer experience.</td></tr>
<tr><td>Explain storage services (S3, Blob)</td><td>Object storage as buckets/containers of objects addressed by key and reached over an HTTP API; the three shapes (object, block, file) with S3/EBS/EFS, Blob/Managed Disks/Azure Files and Cloud Storage/Persistent Disk/Filestore; write-once read-many fit; durability versus availability, with S3's eleven-nines durability design figure; access tiers with lifecycle rules; versioning and cross-region replication.</td></tr>
<tr><td>Explain compute services (EC2, Lambda, GCE)</td><td>EC2 as elastic virtual machines with images, security groups, networks, purchasing models and auto-scaling (the demand-driven provisioning of 6.4); Lambda as event-driven serverless with per-invocation billing, automatic scaling and stateless functions; GCE as Google's VM service with preemptible VMs; and the three-model table and Fig 7.1 showing what each model leaves the customer to manage.</td></tr>
<tr><td>Why is vendor lock-in a problem?</td><td>Because migrating a VM between IaaS providers is difficult, as the reference deck states &mdash; which is also why the reference architecture includes portability and interoperability, and why containers and Kubernetes are a partial remedy.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch5/ref-cloudcomptng-s61-127.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s61-127.webp" alt="The following diagram shows how PaaS offers an API and development tools to the developers and how it helps the end user to access business applications." width="560" height="427" loading="lazy" decoding="async">
<figcaption><strong>slide 61</strong> &middot; Ref_CloudComptng.pptx &mdash; The following diagram shows how PaaS offers an API and development tools to the developers and how it helps the end user to access business applications.</figcaption>
</figure>
<!-- /dcc-fig -->

<!-- dcc-fig-extras:start -->
<h2>Extra slides from the reference deck, not on the syllabus</h2>
<p>The reference deck's slides 79&ndash;93 are a survey of networking protocols &mdash; what a protocol is, the gossip or epidemic protocol, OSI and CNLP fragmentation, routing with IP/IPX/RIP, multicast, SSH and SFTP, packet loss, XMPP, wireless protocols, IGRP, PTP and MTP. The syllabus names <em>none</em> of them: search the printed sub-topics for protocol, OSI, routing, gossip, CNLP or MTP and there is no match, and no question on the Model Question 2025 concerns them. They are kept here because they are your teacher's material and worth seeing once, in one place, labelled for what they are &mdash; rather than scattered through the unit, where a slide about routing defaults sits under a heading about pizza. Nothing here is examinable from this syllabus; the messaging and web-service material that <em>is</em> examinable is Unit 2.</p>
<!-- dcc-fig:ch5/ref-cloudcomptng-s80-132.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s80-132.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 80" width="638" height="479" loading="lazy" decoding="async">
<figcaption><strong>slide 80</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch5/ref-cloudcomptng-s81-133.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s81-133.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 81" width="638" height="479" loading="lazy" decoding="async">
<figcaption><strong>slide 81</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch5/ref-cloudcomptng-s82-134.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s82-134.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 82" width="638" height="479" loading="lazy" decoding="async">
<figcaption><strong>slide 82</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch5/ref-cloudcomptng-s83-135.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s83-135.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 83" width="638" height="479" loading="lazy" decoding="async">
<figcaption><strong>slide 83</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch5/ref-cloudcomptng-s84-136.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s84-136.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 84" width="638" height="479" loading="lazy" decoding="async">
<figcaption><strong>slide 84</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch5/ref-cloudcomptng-s85-137.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s85-137.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 85" width="638" height="479" loading="lazy" decoding="async">
<figcaption><strong>slide 85</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch5/ref-cloudcomptng-s86-138.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s86-138.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 86" width="638" height="479" loading="lazy" decoding="async">
<figcaption><strong>slide 86</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch5/ref-cloudcomptng-s87-139.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s87-139.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 87" width="638" height="479" loading="lazy" decoding="async">
<figcaption><strong>slide 87</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch5/ref-cloudcomptng-s88-140.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s88-140.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 88" width="638" height="479" loading="lazy" decoding="async">
<figcaption><strong>slide 88</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch5/ref-cloudcomptng-s89-141.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s89-141.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 89" width="638" height="479" loading="lazy" decoding="async">
<figcaption><strong>slide 89</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch5/ref-cloudcomptng-s90-142.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s90-142.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 90" width="638" height="479" loading="lazy" decoding="async">
<figcaption><strong>slide 90</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch5/ref-cloudcomptng-s91-143.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s91-143.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 91" width="638" height="479" loading="lazy" decoding="async">
<figcaption><strong>slide 91</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch5/ref-cloudcomptng-s92-144.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s92-144.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 92" width="638" height="479" loading="lazy" decoding="async">
<figcaption><strong>slide 92</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch5/ref-cloudcomptng-s93-145.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch5/ref-cloudcomptng-s93-145.webp" alt="Diagram from Ref_CloudComptng.pptx, slide 93" width="638" height="479" loading="lazy" decoding="async">
<figcaption><strong>slide 93</strong> &middot; Ref_CloudComptng.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- /dcc-fig-extras -->


`,

  quiz: [
    {
      q: 'Which four service groups does the course\'s reference deck say an IaaS provider supplies?',
      options: [
        'Compute, storage, network and load balancers',
        'Email, office software, CRM and storage',
        'Compilers, runtimes, frameworks and databases',
        'Regions, zones, consoles and billing'
      ],
      answer: 0,
      explanation: 'Compute (virtual CPUs and virtual main memory for the VMs), storage (back-end storage for files), network (Network as a Service — routers, switches and bridges for the VMs) and load balancing at the infrastructure layer.'
    },
    {
      q: 'Which of these is listed as a disadvantage of the IaaS layer?',
      options: [
        'It does not allow users to share physical infrastructure',
        'Interoperability issues — it is difficult to migrate a VM from one IaaS provider to another, leading to vendor lock-in',
        'It charges a flat monthly fee regardless of use',
        'It requires the customer to own the hardware'
      ],
      answer: 1,
      explanation: 'The three disadvantages are security (no provider can offer 100% security), maintenance and upgrade (providers maintain software but do not upgrade it for some organisations) and interoperability issues causing vendor lock-in.'
    },
    {
      q: 'In the pizza analogy for cloud service models, IaaS corresponds to:',
      options: [
        'Dining out at a restaurant',
        'Dining in at home and making everything yourself',
        'Take and bake — the vendor delivers the ingredients, you supply the oven',
        'Having a pizza delivered'
      ],
      answer: 2,
      explanation: 'Take-and-bake is IaaS: the vendor supplies the dough, sauce, toppings and cheese while you provide the table, oven and fire. On-premises is dining in at home, PaaS is pizza delivered (the oven work is done for you) and SaaS is dining out (everything is the restaurant\'s).'
    },
    {
      q: 'What is XaaS?',
      options: [
        'A single vendor\'s product family',
        'A collective term for delivering anything (products, tools, technologies) as a service over a network rather than locally',
        'A security standard for cloud APIs',
        'The billing system used by cloud providers'
      ],
      answer: 1,
      explanation: 'XaaS — Anything/Everything as a Service — recognises the many things vendors now deliver over the internet. The most common examples are SaaS, PaaS and IaaS, with others such as Hardware-as-a-Service, Communication-as-a-Service, Desktop-as-a-Service, Security-as-a-Service, Database-as-a-Service and Transportation-as-a-Service.'
    },
    {
      q: 'Which XaaS model is described as especially cost-effective for small or mid-sized businesses, and similar to leasing?',
      options: [
        'HaaS — Hardware as a Service',
        'SECaaS — Security as a Service',
        'TaaS — Transportation as a Service',
        'DRaaS'
      ],
      answer: 0,
      explanation: 'In HaaS (here Hardware as a Service), managed service providers own hardware and install it at customers\' sites on demand, with customers using it under SLAs on a pay-as-you-go basis — comparable to IaaS when computing resources sit at the provider\'s site as virtual equivalents of physical hardware.'
    },
    {
      q: 'Which storage shape stores objects addressed by a key and reached over an HTTP API rather than being mounted?',
      options: [
        'Block storage',
        'File storage',
        'Object storage',
        'Archive storage'
      ],
      answer: 2,
      explanation: 'Object storage — Amazon S3 buckets, Azure Blob containers, Google Cloud Storage buckets — holds objects addressed by key, with the data and its metadata alongside; the interface is HTTP verbs on a URL, which is the REST style from Unit 2.4 used as a storage API. EBS is block storage and EFS is file storage.'
    },
    {
      q: 'Why does object storage suit write-once, read-many data?',
      options: [
        'Because objects cannot be deleted',
        'Because operations are PUT, GET and DELETE on whole objects, so an object is replaced entire rather than modified in place',
        'Because it has no replication',
        'Because it requires a file system driver'
      ],
      answer: 1,
      explanation: 'Object storage has no open/read/write/seek — an object is replaced whole — which is the GFS/HDFS access pattern from Unit 4.2.9, and for the same reason: it removes most concurrent-modification problems by construction. Deleting and overwriting are possible, which is why versioning matters.'
    },
    {
      q: 'What is the difference between durability and availability for object storage?',
      options: [
        'They are the same property measured in different units',
        'Durability is the probability the data survives; availability is the probability you can reach it now',
        'Durability applies to block storage only',
        'Availability is guaranteed by versioning'
      ],
      answer: 1,
      explanation: 'AWS documents S3 as designed for 99.999999999% (eleven nines) durability in standard storage — a statement about the data surviving — while availability is about being able to read it at a given moment. Questions often use the terms interchangeably, so define them.'
    },
    {
      q: 'Which AWS service is the block-storage counterpart to S3\'s object storage?',
      options: [
        'SimpleDB',
        'EBS — Elastic Block Store',
        'Lambda',
        'CloudFront'
      ],
      answer: 1,
      explanation: 'The course\'s reference book names EC2, S3, EBS (Elastic Block Store) and SimpleDB together. EBS volumes attach to instances and are formatted with a file system by the guest OS, unlike S3 buckets which are reached by HTTP API.'
    },
    {
      q: 'In the course material, which virtual machine monitor does Amazon EC2 use?',
      options: [
        'VMware ESXi',
        'Microsoft Hyper-V',
        'Xen',
        'VirtualBox'
      ],
      answer: 2,
      explanation: 'The Chapter 6 deck states that Amazon\'s EC2 uses Xen as the virtual machine monitor, and that the same VMM is used in IBM\'s Blue Cloud. It also notes EC2 provides predefined VM templates users can choose from, while Blue Cloud provides none.'
    },
    {
      q: 'Which EC2 purchasing model is right for a steady, predictable load?',
      options: [
        'On-demand per second',
        'Reserved capacity with a one- or three-year commitment at a large discount',
        'Spot instances',
        'Preemptible VMs'
      ],
      answer: 1,
      explanation: 'On-demand is for variable or short work; reserved purchases fit a steady baseline; spot instances (Google\'s equivalent is preemptible VMs) use spare capacity at a deep discount but can be reclaimed by the provider, so they suit interruptible work.'
    },
    {
      q: 'Which statement about AWS Lambda is correct?',
      options: [
        'It keeps a server running and bills per hour',
        'It runs code in response to events, bills per invocation and execution duration, and scales automatically per request',
        'It requires the customer to patch the operating system',
        'It is a managed database service'
      ],
      answer: 1,
      explanation: 'Serverless means there is no server to boot, size or pay for: the code runs in response to an event, billing is per invocation and duration, scaling is automatic and per request, and functions are stateless between invocations — so state lives in storage or a managed database.'
    },
    {
      q: 'Google\'s serverless compute service is:',
      options: [
        'GCE',
        'Cloud Functions',
        'GKE',
        'Persistent Disk'
      ],
      answer: 1,
      explanation: 'The mapping is Compute Engine (GCE) for virtual machines, Cloud Functions for serverless and GKE for Kubernetes; Persistent Disk is block storage. The equivalents on the other platforms are EC2/Lambda/EKS and Azure Virtual Machines/Functions/AKS.'
    },
    {
      q: 'Why do all three major cloud platforms now offer virtual machines, containers and serverless functions?',
      options: [
        'Because a regulator requires it',
        'Because the services are APIs, and an API that becomes widely used becomes a de facto standard the others must match',
        'Because virtual machines became obsolete',
        'Because containers cannot run on virtual machines'
      ],
      answer: 1,
      explanation: 'Once one provider defines a useful interface — object storage buckets, instances with images and disks, containers with an orchestrator, functions invoked by events — the others must offer an equivalent or lose the customer\'s application. That is also why the concepts transfer between providers while the management APIs, identity model and proprietary services do not.'
    },
    {
      q: 'What are regions and availability zones used for?',
      options: [
        'To reduce the price of storage',
        'To place replicas across isolated fault domains so one zone\'s failure is survivable',
        'To define which programming languages are supported',
        'To route traffic to the nearest database'
      ],
      answer: 1,
      explanation: 'A region is a geographic area and an availability zone is an isolated set of data centres within it. Placing replicas across zones applies Unit 1\'s independent-failures characteristic as a design rule — the same reasoning as HDFS block replication across physically separate machines in Unit 4.'
    },
    {
      q: 'A managed database service (DBaaS) differs from running a database on a rented virtual machine because:',
      options: [
        'It cannot be backed up',
        'The provider handles replication, patching, backup and failover',
        'It does not support SQL',
        'It runs only in the public cloud'
      ],
      answer: 1,
      explanation: 'Database as a Service provides access to a database platform through the cloud, and public cloud providers like AWS and Azure have DBaaS offerings. A database on a rented VM is IaaS plus your own administration; the managed service takes over the operational work.'
    }
  ],

  past: [
    {
      year: '2025 (expected)',
      marks: '5',
      repeats: 1,
      q: 'Differentiate between Object Storage and Block Storage in cloud computing.',
      occ: [
        { year: '2025 (expected)', marks: '5', q: 'Differentiate between Object Storage and Block Storage in cloud computing.' }
      ],
      answer: `
<h4>Model answer &mdash; 5 marks</h4>
<p>These are the two storage abstractions a cloud offers, and they differ in the unit of
addressing and in what the store knows about the data.</p>
<table class="comparison-table">
<tr><th>Aspect</th><th>Block storage</th><th>Object storage</th></tr>
<tr><td>Unit</td><td>A fixed-size block, addressed by number</td><td>A whole object (data plus metadata plus an id), addressed by key</td></tr>
<tr><td>Seen by the client as</td><td>A raw volume &mdash; a disk, so you format it and mount a file system</td><td>An HTTP-accessible bucket of keys &mdash; no file system</td></tr>
<tr><td>Metadata</td><td>None beyond the block; meaning lives in the file system above it</td><td>Rich per-object metadata, which makes search and lifecycle rules possible</td></tr>
<tr><td>Edits</td><td>In place, at block granularity</td><td>Whole-object; a change writes a new version</td></tr>
<tr><td>Scale</td><td>Bounded by the volume; must be attached to one instance</td><td>Effectively unbounded; reached over the network from anywhere</td></tr>
<tr><td>Typical use</td><td>Database files, boot volumes, anything needing low-level I/O</td><td>Images, backups, logs, static assets, data lakes</td></tr>
<tr><td>Example</td><td>AWS EBS</td><td>AWS S3</td></tr>
</table>
<p>The deciding question is whether the workload needs to <em>write in place at low level</em>:
if yes, block; if it stores whole things and reads them back, object, which is cheaper and
scales further but cannot host a database.</p>
<div class="concept-box tip">
<h4>Marking this one</h4>
<p>Predicted, and the weakest-sourced of the set &mdash; the previous site labels it only
“Expected”. It sits in Unit 7's part of the syllabus (cloud platforms and services),
which is the unit with no lecture deck, so this card is written from the reference decks and
the textbooks like the rest of the unit.</p>
</div>
`
    },
  ]
};

;
/* ch8.js */
/* Chapter 8 — Security and Challenges in Cloud.

   Syllabus unit 8: 6 hours, 8 marks. Sub-topics 8.1 Data security, privacy and
   compliance, 8.2 Identity and access management (IAM), 8.3 Service Level
   Agreements (SLA), 8.4 Cloud vulnerabilities and risk mitigation.

   Written from the course's own material, read into `_source/dcc/` by
   tools/dcc_extract.py:

     lecture_notes_all_chapterwise_lecturenote_ch_8.txt
         Er. Avijit Karn's 24-slide Chapter 8 deck — data security aspects,
         data lineage and provenance, data remanence, IAM, data privacy and its
         key concerns, the data life cycle and the two SLA topics (criteria and
         life cycle, and SLA management in the cloud)

     lecture_notes_all_chapterwise_cloud_vulnerabilities_and_risk_mitigation.txt
         the two-page vulnerabilities and risk-mitigation reference, which is
         the only source in the folder that is a table rather than a slide
         deck — its eight vulnerabilities and eight control areas are
         reproduced as tables here

   Model Question 2025, Group B question 12 ("Briefly describe two challenges in
   ensuring security in cloud environments", 4 marks) is answered in 8.4.5. */

window.CHAPTERS = window.CHAPTERS || {};
window.CHAPTERS[8] = {
  learn: `

<h2>Unit 8 &mdash; Security and Challenges in Cloud</h2>
<p class="unit-meta">Syllabus: 6 hours &middot; 8 marks &middot; sub-topics 8.1&ndash;8.4</p>

<div class="concept-box asked">
<h4>What this unit is worth in the exam</h4>
<ul>
<li><strong>4 marks</strong> &mdash; &ldquo;Briefly describe two challenges in ensuring security in cloud environments.&rdquo; (Group B, question 12 of the <em>Model Question 2025</em>)</li>
</ul>
<p>Eight syllabus marks, so this unit is weighted as heavily as Unit 6. Two things make it easy to answer well: <strong>the question says "briefly describe two"</strong>, so depth on two named challenges beats a list of eight; and the unit has a <strong>structured vocabulary</strong> &mdash; the four data-security aspects, the five IAM functions, the five SLA criteria and the eight vulnerabilities &mdash; that turns a vague answer into a specific one. Every other unit's material appears here at the point where it becomes a risk: the hypervisor of Unit 6 as an attack surface, vendor lock-in from Unit 5, and shared responsibility as the boundary between them.</p>
</div>

<p>The unit's four sub-topics answer four different questions about the same thing, and keeping them apart is most of the work. <strong>8.1 Data security, privacy and compliance</strong> asks <em>what must be protected, and under what obligation</em> &mdash; the three states of data, provenance, remanence, privacy and the data life cycle. <strong>8.2 Identity and Access Management</strong> asks <em>who may do it</em>, which in the cloud means identity rather than a location inside the network. <strong>8.3 Service Level Agreements</strong> asks <em>what was promised</em>, in measurable criteria, and what happens when the promise is missed. <strong>8.4 Cloud vulnerabilities and risk mitigation</strong> asks <em>what actually goes wrong</em>, and who is responsible for each part of preventing it. The shared responsibility model in 8.4.3 is where all four meet, so it is worth reading twice.</p>

<p>Two habits make this unit much easier to answer. First, <strong>attach a concrete mechanism to every named risk</strong> &mdash; a vulnerability list is worth few marks, while two vulnerabilities with their mechanism and their control is worth full marks, which is exactly what the paper's Group B question asks for. Second, <strong>reach back into the earlier units</strong>: this unit is where the hypervisor of 6.1.10 becomes an attack surface, storage virtualisation becomes multi-tenancy, and the provider's promise becomes an SLA. Naming that link is what makes a security answer specific to the cloud rather than a general list of security advice.</p>

<h2>8.1 Data security, privacy and compliance</h2>

<h3>8.1.1 The three states of data, and how each is protected</h3>
<p>The deck separates data security into four aspects, and the first three are the states data can be in. This is the cleanest structure for the opening of a security answer:</p>

<table class="comparison-table">
<thead>
<tr><th>Aspect</th><th>What the deck says</th><th>What it means in practice</th></tr>
</thead>
<tbody>
<tr><td><strong>Data-in-transit</strong></td><td>Two options: <strong>confidentiality + integrity using a secured protocol</strong>, or <strong>confidentiality with a non-secured protocol and encryption</strong>.</td><td>Either the transport protects itself (TLS) or the payload does. The distinction matters in an exam because "we use HTTPS" is the first answer and "we encrypt the payload even over an untrusted channel" is the second &mdash; and a strong answer mentions integrity, not just secrecy, because an attacker who can alter data in transit breaks it.</td></tr>
<tr><td><strong>Data-at-rest</strong></td><td><strong>Generally not encrypted, since data is commingled with other users' data.</strong> The deck then asks the questions that follow: <strong>encryption if it is not associated with applications? Indexing and searching? Homomorphic encryption versus predicate encryption?</strong></td><td>The tension is that encryption defeats the provider's ability to index or search the data. That is why the frontier techniques named are <em>homomorphic</em> encryption (computing on ciphertext) and <em>predicate</em> encryption (revealing only records matching a condition) &mdash; both are attempts to have confidentiality and searchability at once.</td></tr>
<tr><td><strong>Processing of data, including multitenancy</strong></td><td><strong>For any application to process data, it is not encrypted.</strong></td><td>The hardest case: data must be decrypted to be computed on, so trust in the platform &mdash; and in its operators &mdash; cannot be avoided by cryptography alone. This is where Unit 6's hypervisor isolation becomes a security control rather than a performance feature.</td></tr>
<tr><td><strong>Data lineage (knowing when and where data was)</strong></td><td><strong>Knowing when and where the data was located within the cloud is important for audit and compliance purposes.</strong> The deck's example is Amazon AWS: <strong>store &lt;d1, t1, ex1.s3.amazonaws.com&gt;</strong>, <strong>process &lt;d2, t2, ec2.compute2.amazonaws.com&gt;</strong>, <strong>restore &lt;d3, t3, ex2.s3.amazonaws.com&gt;</strong>.</td><td>Each operation is recorded as a data identifier, a timestamp and the endpoint that performed it. That record is what makes it possible to answer "where was this record at 14:00 last Tuesday", which is what an auditor asks.</td></tr>
</tbody>
</table>

<h3>8.1.2 Data provenance &mdash; the question security cannot answer</h3>
<p><strong>Data provenance</strong> extends lineage into <strong>computational accuracy as well as data integrity</strong>. The deck's example is deliberately mundane, and it is worth reproducing because it shows how far the problem reaches:</p>
<p>A financial calculation &mdash; <strong>sum((((2&times;3)&times;4)/6) &minus; 2) = $2.00</strong> &mdash; is correct <em>assuming US dollars</em>. Then the questions begin: <strong>how about dollars of different countries? The correct exchange rate? Where is (or was) that system located? What was the state of that physical system? How would a customer or auditor verify that information?</strong></p>
<div class="concept-box key">
<h4>Why this is a cloud problem specifically</h4>
<p>Because the workload ran on a machine the customer does not own, in a jurisdiction they may not know, at a time they cannot independently verify. <strong>Integrity of data is not integrity of computation</strong> &mdash; the bytes can be untouched while the result is wrong because the environment, the exchange rate table or the machine's state changed. That is why provenance, and the auditability in 8.3, belong in the same unit as encryption.</p>
</div>

<h3>8.1.3 Data remanence and the provider's own data</h3>
<p><strong>Data remanence</strong> is the risk of <strong>inadvertent disclosure of sensitive information</strong> &mdash; data that remains where it was not intended to remain. It connects directly to Unit 6's storage virtualization, where servers are "not aware of exactly where their data is stored": if you do not know which physical disks hold your blocks, proving that a deleted copy is really gone is correspondingly harder.</p>
<p>The deck then states the risk of centralisation plainly: <strong>to the extent that quantities of data from many companies are centralised, this collection can become an attractive target for criminals. Moreover, the physical security of the data centre and the trustworthiness of system administrators take on new importance.</strong> Two consequences follow, and both are examinable: <strong>aggregation raises the value of a breach</strong> (one incident affects many tenants at once), and <strong>physical security and administrator trust become part of the customer's risk</strong> even though neither is under the customer's control.</p>

<h3>8.1.4 Data privacy</h3>
<div class="concept-box key">
<h4>The definition to quote &mdash; including its honest part</h4>
<p><strong>The concept of privacy varies widely among (and sometimes within) countries, cultures and jurisdictions. It is shaped by public expectations and legal interpretations, so a concise definition is elusive if not impossible.</strong> Privacy rights or obligations are related to <strong>the collection, use, disclosure, storage and destruction of personal data</strong> (or <strong>Personally Identifiable Information &mdash; PII</strong>). And the deck's conclusion: <strong>at the end of the day, privacy is about the accountability of organisations to data subjects, as well as the transparency of an organisation's practices around personal information.</strong></p>
</div>

<p>The deck warns that these concerns <strong>typically mix security and privacy</strong>, and lists five to be aware of. Each one comes with the questions an examination answer can quote, which is the fastest way to show understanding:</p>

<table class="comparison-table">
<thead>
<tr><th>Concern</th><th>The questions the deck raises</th></tr>
</thead>
<tbody>
<tr><td><strong>Storage</strong></td><td><strong>The aggregation of data raises new privacy issues.</strong> <strong>Some governments may decide to search through data without notifying the data owner, depending on where the data resides</strong> &mdash; which is data residency as a privacy problem. And: <strong>whether the cloud provider itself has any right to see and access customer data?</strong> Some services <strong>track user behaviour</strong> for purposes from targeted advertising to improving services.</td></tr>
<tr><td><strong>Retention</strong></td><td><strong>How long is personal information transferred to the cloud retained? Which retention policy governs the data? Does the organisation own the data, or the CSP? Who enforces the retention policy in the cloud, and how are exceptions such as litigation holds managed?</strong></td></tr>
<tr><td><strong>Destruction</strong></td><td><strong>How does the provider destroy PII at the end of the retention period? How do organisations ensure their PII is destroyed by the CSP at the right point and is not available to other cloud users?</strong> The structural difficulty: <strong>cloud storage providers usually replicate the data across multiple systems and sites &mdash; increased availability is one of the benefits they provide. How do you know the CSP did not retain additional copies? Did the CSP really destroy the data, or just make it inaccessible to the organisation? Is the CSP keeping the information longer than necessary so it can mine the data for its own use?</strong></td></tr>
<tr><td><strong>Auditing, monitoring and risk management</strong></td><td><strong>How can organisations monitor their CSP and provide assurance to stakeholders that privacy requirements are met when their PII is in the cloud? Are they regularly audited? What happens in the event of an incident?</strong> And the organisational consequence: <strong>if business-critical processes are migrated to cloud, internal security processes need to evolve to allow multiple cloud providers to participate in them &mdash; including security monitoring, auditing, forensics, incident response and business continuity.</strong></td></tr>
<tr><td><strong>Privacy breaches</strong></td><td><strong>How do you know a breach has occurred? How do you ensure the CSP notifies you when one occurs? Who is responsible for managing the breach notification process (and its costs)? Do contracts include liability for breaches resulting from negligence of the CSP? How is the contract enforced? How is it determined who is at fault?</strong></td></tr>
</tbody>
</table>

<div class="concept-box tip">
<h4>The single most useful sentence in 8.1</h4>
<p>The <strong>destruction</strong> row is the best answer to "why is data deletion harder in the cloud": <strong>replication &mdash; the very feature that makes cloud storage reliable &mdash; is what makes proven destruction hard</strong>, because a copy may exist in a system or site you did not think about. This is data remanence with a mechanism attached, and it is why contracts have to say what "deleted" means.</p>
</div>

<h3>8.1.5 Compliance and the data life cycle</h3>
<p>Compliance is managed over a <strong>data life cycle</strong>, and the deck's two rules are that <strong>personal information should be managed as part of the data used by the organisation</strong> and that <strong>protection of personal information should consider the impact of the cloud on each phase</strong>. The slide's seven phases are drawn as a cycle:</p>
<!-- dcc-fig:ch8/lecturenote-ch-8-s16-149.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch8/lecturenote-ch-8-s16-149.webp" alt="Data life cycle (in Data Compliance)" width="638" height="401" loading="lazy" decoding="async">
<figcaption><strong>slide 16</strong> &middot; LectureNote_Ch _8.pptx &mdash; Data life cycle (in Data Compliance)</figcaption>
</figure>
<!-- /dcc-fig -->
<figure class="figure-wide figure-wrap">
<svg class="figure wide" viewBox="0 0 800 260" role="img" aria-label="The data life cycle in seven phases: generation, transformation, transfer, use, storage, archival and destruction">
<defs><marker id="f8a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="flow-arrow-head"/></marker></defs>

<rect class="flow-box phase1" x="20" y="60" width="96" height="48" rx="8"/>
<text class="flow-label" x="68" y="88" text-anchor="middle">1 Generation</text>
<rect class="flow-box phase1" x="132" y="60" width="104" height="48" rx="8"/>
<text class="flow-label" x="184" y="88" text-anchor="middle">2 Transformation</text>
<rect class="flow-box phase2" x="252" y="60" width="90" height="48" rx="8"/>
<text class="flow-label" x="297" y="88" text-anchor="middle">3 Transfer</text>
<rect class="flow-box phase2" x="358" y="60" width="76" height="48" rx="8"/>
<text class="flow-label" x="396" y="88" text-anchor="middle">4 Use</text>
<rect class="flow-box phase3" x="450" y="60" width="90" height="48" rx="8"/>
<text class="flow-label" x="495" y="88" text-anchor="middle">5 Storage</text>
<rect class="flow-box phase3" x="556" y="60" width="92" height="48" rx="8"/>
<text class="flow-label" x="602" y="88" text-anchor="middle">6 Archival</text>
<rect class="flow-box phase4" x="664" y="60" width="110" height="48" rx="8"/>
<text class="flow-label" x="719" y="88" text-anchor="middle">7 Destruction</text>

<path class="flow-arrow" d="M117,84 H129" marker-end="url(#f8a)"/>
<path class="flow-arrow" d="M237,84 H249" marker-end="url(#f8a)"/>
<path class="flow-arrow" d="M343,84 H355" marker-end="url(#f8a)"/>
<path class="flow-arrow" d="M435,84 H447" marker-end="url(#f8a)"/>
<path class="flow-arrow" d="M541,84 H553" marker-end="url(#f8a)"/>
<path class="flow-arrow" d="M649,84 H661" marker-end="url(#f8a)"/>

<text class="flow-label" x="400" y="42" text-anchor="middle">The cloud changes the risk at each phase, so protection is designed per phase:</text>
<text class="flow-label" x="400" y="146" text-anchor="middle">Transfer is where data-in-transit protection applies; storage and archival are where data-at-rest and retention policy apply;</text>
<text class="flow-label" x="400" y="170" text-anchor="middle">use is where the multitenancy question bites, because processing requires the data to be readable;</text>
<text class="flow-label" x="400" y="194" text-anchor="middle">and destruction is where replication makes proof of deletion hard (8.1.4).</text>
<text class="flow-label" x="400" y="228" text-anchor="middle">Where the deck's own slide names a phase but not its number, the standard name is used and marked here for what it is.</text>
</svg>
<figcaption><strong>Fig 8.1 &mdash; The data life cycle used for data compliance.</strong> Generation, transformation, transfer, storage, archival and destruction are the deck's own phase labels; the fourth phase (use) is the standard name for the step in that position, because that slide's label was not legible in the scan. The point of drawing it as a cycle is that the obligations continue until destruction &mdash; not until the data stops being used.</figcaption>
</figure>

<p>The deck gives the phase names and two rules; the teaching is in taking the phase names one at a time and asking what the cloud changes at each. That is exactly the exercise the second rule asks for &mdash; <em>consider the impact of the cloud on each phase</em> &mdash; and it is what turns a list of seven words into an answer.</p>

<table class="comparison-table">
<thead>
<tr><th>Phase</th><th>What happens</th><th>What the cloud changes</th></tr>
</thead>
<tbody>
<tr><td><strong>1. Generation</strong></td><td>The data is created or collected &mdash; a form submitted, a sensor reading, a click logged.</td><td>Collection becomes cheap enough to be indiscriminate, and the data is often produced in one jurisdiction while the organisation is in another. Decide what you are allowed to collect <em>before</em> you collect it.</td></tr>
<tr><td><strong>2. Transformation</strong></td><td>It is converted, combined, aggregated, indexed or anonymised into something usable.</td><td>Each transformation makes <strong>more copies in more places</strong>, and a de-identification step done wrongly is a breach rather than a report. This is where Unit 8.2's IAM decides who may run it.</td></tr>
<tr><td><strong>3. Transfer</strong></td><td>It moves &mdash; between services, between a customer and the provider, between regions.</td><td><strong>The classic compliance problem</strong>: a copy in another region is a copy under another legal regime. Encryption in transit, from 8.1.1, is the technical half of the answer.</td></tr>
<tr><td><strong>4. Use</strong></td><td>People and applications read, query and act on it.</td><td>Access arrives over the network rather than from a desk, so access control moves from the building to <strong>identity</strong> (8.2) and every read becomes a loggable event.</td></tr>
<tr><td><strong>5. Storage</strong></td><td>It rests in a database, an object store or a volume.</td><td>At-rest encryption, and the two problems Unit 8.1 already named: <strong>provenance</strong> (8.1.2) and <strong>remanence</strong> (8.1.3) &mdash; plus the provider's own backups, which you do not see.</td></tr>
<tr><td><strong>6. Archival</strong></td><td>It is retained, rarely read, for obligation or history &mdash; the Glacier and archive tiers from Unit 7.2.2.</td><td>Retention law and the right to erasure pull in opposite directions, so archival data must stay <em>findable</em>. You cannot destroy what you cannot locate.</td></tr>
<tr><td><strong>7. Destruction</strong></td><td>It is disposed of at the end of its life.</td><td>Deletion is a request to a provider, not an act you perform. Certified deletion is the answer, and remanence is the reason it has to be certified.</td></tr>
</tbody>
</table>

<p>Two sentences pull that together and either is a good closing line. <strong>Compliance is a property of the whole life cycle, not of the moment data is stored</strong> &mdash; which is why the deck says personal information must be managed <em>as part of the data used by the organisation</em> rather than as a separate category to be locked away. And <strong>the cloud multiplies the copies while shortening the list of places you can point at</strong>: the same object may exist in three regions, in a backup you cannot see and in a cache you did not design, and the obligation follows all of them.</p>

<div class="concept-box tip">
<h4>The exam framing</h4>
<p>If a question asks how compliance is handled in the cloud, give the two rules first, then the cycle, then <strong>two phases with their cloud impact</strong> &mdash; transfer across borders and destruction are the strongest pair because both are cloud-specific. Close with the division of responsibility from 8.4.3: the provider can certify the platform, but <strong>knowing what data you hold and why is the customer's job</strong>.</p>
</div>

<h2>8.2 Identity and Access Management (IAM)</h2>

<h3>8.2.1 What IAM is</h3>
<div class="concept-box key">
<p><strong>IAM is a framework of policies and technologies. It ensures that the right individuals get the right access to the right resources.</strong></p>
</div>
<p>The deck names its <strong>core functions</strong> &mdash; <strong>authentication, authorisation, user management, policy enforcement and auditing</strong> &mdash; and then expands each one. This is the table a question about IAM wants:</p>

<table class="comparison-table">
<thead>
<tr><th>Function</th><th>What it does</th></tr>
</thead>
<tbody>
<tr><td><strong>Authentication</strong></td><td><strong>Verifies identity</strong> &mdash; the deck's examples are <strong>username/password and multi-factor authentication (MFA)</strong>.</td></tr>
<tr><td><strong>Authorization</strong></td><td><strong>Defines permissions and actions</strong> &mdash; what an authenticated identity is allowed to do.</td></tr>
<tr><td><strong>User management</strong></td><td><strong>Manages accounts, groups and roles.</strong> Roles matter more than individual accounts at cloud scale, because permissions are attached to roles and people are moved between them.</td></tr>
<tr><td><strong>Policy enforcement</strong></td><td><strong>Applies security policies</strong> &mdash; the rules in 8.2.1's "framework of policies" made operative.</td></tr>
<tr><td><strong>Audit and compliance</strong></td><td><strong>Logs and monitors activities</strong> &mdash; which is also what makes data lineage (8.1.1) and SLA accounting (8.3.3) possible.</td></tr>
</tbody>
</table>

<p>The deck illustrates IAM with an identity that spans services &mdash; a single set of fields (name, email, password, billing and shipping address, credit card) reused across providers, which is the practical face of federated identity and single sign-on on the cloud.</p>

<h3>8.2.2 Why IAM matters more in the cloud than on premises</h3>
<p>This is the most examinable part of 8.2, because it explains why a familiar topic becomes a different problem. The deck's five reasons:</p>
<ol>
<li><strong>The organisation's trust boundary becomes dynamic and moves beyond its control, extending into the service provider's domain.</strong> &mdash; On premises, the firewall marked the edge of trust. Once workloads move to a provider, the boundary depends on the provider's configuration as well as the organisation's, which is the de-perimeterisation of Unit 5.4.5 made operational.</li>
<li><strong>Managing access for diverse user populations</strong> &mdash; employees, contractors, partners and more &mdash; and <strong>increased demand for authentication</strong>, because personal, financial and medical data are involved and <strong>software applications hosted in the cloud require access control</strong>.</li>
<li><strong>Need for higher-assurance authentication</strong> &mdash; <strong>authentication in the cloud may mean authentication outside the firewall</strong>, where the protections of the internal network do not apply, and there are <strong>limits of password authentication</strong>.</li>
<li><strong>Need for authentication from mobile devices</strong> &mdash; users authenticate from anywhere, over networks the organisation does not control.</li>
</ol>

<figure class="figure-wide figure-wrap">
<svg class="figure wide" viewBox="0 0 800 300" role="img" aria-label="The organisation's trust boundary used to stop at the firewall; in the cloud the boundary extends into the provider domain, so identity and access management becomes the control at the boundary">
<defs><marker id="f8b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="flow-arrow-head"/></marker></defs>

<text class="flow-label" x="185" y="26" text-anchor="middle">On premises: a fixed perimeter</text>
<rect class="flow-box phase1" x="30" y="44" width="310" height="120" rx="10"/>
<text class="flow-label" x="185" y="66" text-anchor="middle">Trust boundary = the firewall</text>
<rect class="flow-box phase2" x="52" y="80" width="120" height="40" rx="8"/><text class="flow-label" x="112" y="105" text-anchor="middle">Users</text>
<rect class="flow-box phase2" x="196" y="80" width="120" height="40" rx="8"/><text class="flow-label" x="256" y="105" text-anchor="middle">Resources</text>
<text class="flow-label" x="185" y="146" text-anchor="middle">Everything inside is trusted by location.</text>

<text class="flow-label" x="610" y="26" text-anchor="middle">Cloud: a boundary that moves</text>
<rect class="flow-box phase1" x="430" y="44" width="150" height="120" rx="10"/>
<text class="flow-label" x="505" y="66" text-anchor="middle">Organisation</text>
<rect class="flow-box phase2" x="452" y="80" width="106" height="40" rx="8"/><text class="flow-label" x="505" y="105" text-anchor="middle">Users</text>
<text class="flow-label" x="505" y="146" text-anchor="middle">no fixed edge</text>
<rect class="flow-box phase3" x="620" y="44" width="150" height="120" rx="10"/>
<text class="flow-label" x="695" y="66" text-anchor="middle">Provider domain</text>
<rect class="flow-box phase4" x="642" y="80" width="106" height="40" rx="8"/><text class="flow-label" x="695" y="105" text-anchor="middle">Resources</text>
<text class="flow-label" x="695" y="146" text-anchor="middle">controls are shared</text>

<path class="flow-arrow" d="M584,104 H616" marker-end="url(#f8b)"/>
<text class="flow-label" x="600" y="200" text-anchor="middle">The boundary now depends on the</text>
<text class="flow-label" x="600" y="220" text-anchor="middle">provider's configuration as well as yours.</text>
<text class="flow-label" x="600" y="248" text-anchor="middle">So the control has to be identity: authentication,</text>
<text class="flow-label" x="600" y="268" text-anchor="middle">authorisation and audit &mdash; not network location.</text>
</svg>
<figcaption><strong>Fig 8.2 &mdash; Why IAM becomes the control when the perimeter moves.</strong> The deck's own statement is that <em>the organisation's trust boundary will become dynamic and will move beyond its control, extending into the service provider domain</em>. Once that is true, "inside the firewall" stops being a security property, and the only controls left are the ones that travel with the request: who is asking, what they are allowed to do, and the record of what they did.</figcaption>
</figure>

<h2>8.3 Service Level Agreements (SLA)</h2>

<h3>8.3.1 What an SLA is</h3>
<div class="concept-box key">
<p>An SLA is the <strong>service contract with the cloud service provider</strong>. <strong>SLAs provide a level of service for each service, specified in the form of a minimum level of service guaranteed and a target level</strong>, and they <strong>contain a number of performance metrics and the corresponding service objectives</strong>. It outlines <strong>the broad understanding between provider and consumer for conducting business and forms the basis for a mutually beneficial relationship</strong> &mdash; and <strong>from a legal perspective, the terms and conditions that bind the service provider to provide services continually are formally defined in the SLA</strong>.</p>
</div>
<!-- dcc-fig:ch8/lecturenote-ch-8-s17-150.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch8/lecturenote-ch-8-s17-150.webp" alt="Diagram from LectureNote_Ch _8.pptx, slide 17" width="1314" height="343" loading="lazy" decoding="async">
<figcaption><strong>slide 17</strong> &middot; LectureNote_Ch _8.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch8/lecturenote-ch-8-s17-151.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch8/lecturenote-ch-8-s17-151.webp" alt="Diagram from LectureNote_Ch _8.pptx, slide 17" width="1065" height="214" loading="lazy" decoding="async">
<figcaption><strong>slide 17</strong> &middot; LectureNote_Ch _8.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>The two-level structure is the detail worth remembering: <strong>a minimum guaranteed level and a target level</strong>. The target is what the provider aims for; the minimum is what it is contractually committed to, and the difference between them is where penalties live. Write it in the deck's own vocabulary and you cannot lose marks: a <strong>metric</strong> is the quantity measured (availability, response time, throughput, mean time to recover) and a <strong>service objective</strong> is the number promised for it. So the smallest complete SLA statement has four parts &mdash; <em>which service</em>, <em>which metric</em>, <em>the guaranteed minimum</em>, <em>the target</em> &mdash; and the remedy if the minimum is missed.</p>

<p>Three details make that concrete. <strong>An SLA is per service, not per provider.</strong> One cloud account is usually covered by many agreements at once &mdash; a compute SLA, a storage SLA, a networking SLA, a support SLA &mdash; and the deck's phrase <em>a level of service for each service</em> is the whole point: a failure can be covered by one and excluded by another. <strong>The remedy is usually service credit, not compensation.</strong> A provider that breaches a minimum typically issues credits against future billing rather than paying for your lost business, which is why an SLA <strong>prices risk instead of removing it</strong> &mdash; the outage still happens, and the credit is the provider's acknowledgement of it. And <strong>the agreement is legally binding</strong>: from a legal perspective the terms and conditions that bind the provider to provide services <em>continually</em> are formally defined in the SLA, which is why it is signed at procurement and quoted at dispute.</p>

<div class="concept-box tip">
<h4>What an SLA does not do</h4>
<p>It is a <strong>floor</strong>, not a description of normal operation. The minimum is chosen to be below what the provider actually expects to deliver, so meeting it does not mean the service was good &mdash; only that it was not in breach. For an exam answer, one sentence earns that mark cleanly: <em>an SLA defines the minimum acceptable service and the remedy when it is not met; it is a risk-allocation document rather than a guarantee of quality.</em></p>
</div>

<h3>8.3.2 The five SLA criteria</h3>
<table class="comparison-table">
<thead>
<tr><th>Criterion</th><th>Its detail</th></tr>
</thead>
<tbody>
<tr><td><strong>Availability</strong></td><td><strong>Percentage of time the service is guaranteed to be available.</strong></td></tr>
<tr><td><strong>Performance</strong></td><td><strong>Response time, throughput.</strong></td></tr>
<tr><td><strong>Disaster recovery</strong></td><td><strong>Mean time to recover.</strong></td></tr>
<tr><td><strong>Problem resolution</strong></td><td><strong>Process to identify problems, support options, resolution expectations.</strong></td></tr>
<tr><td><strong>Security and privacy of data</strong></td><td><strong>Mechanisms for security of data in storage and transmission</strong> &mdash; which is 8.1.1's data-at-rest and data-in-transit, written into the contract.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch8/lecturenote-ch-8-s18-152.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch8/lecturenote-ch-8-s18-152.webp" alt="Diagram from LectureNote_Ch _8.pptx, slide 18" width="753" height="301" loading="lazy" decoding="async">
<figcaption><strong>slide 18</strong> &middot; LectureNote_Ch _8.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<p>Two connections worth making in an answer. First, <strong>availability and performance in an SLA are the same quantities that 6.4.1's provisioning tension trades against</strong>: an SLA that guarantees CPU and memory for a preset period is what makes underprovisioning a penalty and overprovisioning a loss. Second, the <strong>security row means the SLA is a security document</strong>, not only a performance document &mdash; which is why the auditor actor from Unit 6.3.2 exists.</p>

<p>The five rows group into three questions, which is the neatest way to hold them in memory: <strong>what you get</strong> (availability, performance), <strong>what happens when you don't get it</strong> (disaster recovery and mean time to recover, problem resolution), and <strong>what protects the data</strong> (security and privacy of data in storage and transmission). Notice that only two of the five are about speed.</p>

<p>Learn one number to make the availability row mean something. It is a percentage <em>of a period</em>, so it converts directly into downtime: <strong>99.9% of a thirty-day month is about 43 minutes unavailable</strong> (43,200 minutes &times; 0.001), and <strong>99.99% is about 4.3 minutes</strong>. Each additional nine cuts the allowed outage by roughly a factor of ten while the cost of engineering it does not &mdash; which is the whole reason providers publish tiers rather than one guarantee, and why the tier you buy is a business decision about how much downtime your application can survive.</p>

<p>The other four rows are best quoted with the metric each one names. <strong>Performance</strong> is response time and throughput, and it is the row an application actually feels: a service can be perfectly available and still too slow to use. <strong>Disaster recovery</strong> is measured as <strong>mean time to recover</strong> &mdash; how long a failure lasts, not how often it happens &mdash; which links directly to the availability percentage, because the two together fix how much of the month can be lost. <strong>Problem resolution</strong> is the contractual one rather than the technical one: the process for identifying problems, the support options you are entitled to, and the resolution expectations those carry. And <strong>security and privacy</strong> is the mechanisms for protecting data <em>in storage and transmission</em> &mdash; the two states from 8.1.1 written into the contract as an obligation rather than a practice.</p>

<h3>8.3.3 The five phases of the SLA life cycle</h3>
<p>The deck describes the sequence an SLA goes through from identification of terms to termination. Both lists (this one and 8.3.4) contain five phases, and confusing them is the usual mistake &mdash; this one is about <strong>the contract</strong>:</p>
<!-- dcc-fig:ch8/lecturenote-ch-8-s19-153.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch8/lecturenote-ch-8-s19-153.webp" alt="Diagram from LectureNote_Ch _8.pptx, slide 19" width="1057" height="393" loading="lazy" decoding="async">
<figcaption><strong>slide 19</strong> &middot; LectureNote_Ch _8.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<table class="comparison-table">
<thead>
<tr><th>Phase</th><th>What happens</th></tr>
</thead>
<tbody>
<tr><td><strong>1. Contract definition</strong></td><td><strong>Service providers define a set of service offerings and corresponding SLAs using standard templates. These service offerings form a catalog.</strong> <strong>Individual SLAs for enterprises can be derived by customising these base templates.</strong></td></tr>
<tr><td><strong>2. Publishing and discovery</strong></td><td><strong>The provider advertises these base service offerings through standard publication media, and customers should be able to locate the provider by searching the catalog.</strong> <strong>Customers can search different competitive offerings and shortlist a few that fulfil their requirements for further negotiation.</strong></td></tr>
<tr><td><strong>3. Negotiation</strong></td><td>Once a provider meeting the hosting need is found, <strong>the SLA terms and conditions need to be mutually agreed before signing</strong>. <strong>For a standard packaged application offered as a service this phase could be automated; for customised applications hosted on cloud platforms it is manual.</strong> <strong>The provider needs to analyse the application's behaviour with respect to scalability and performance before agreeing on the SLA specification</strong>, and at the end of the phase the SLA is agreed and signed off. The deck notes that <strong>SLA negotiation can utilise WS-negotiation</strong>.</td></tr>
<tr><td><strong>4. Operationalization</strong></td><td><strong>SLA operation consists of SLA monitoring, SLA accounting and enforcement.</strong> <strong>Monitoring</strong> involves <strong>measuring parameter values, calculating the metrics defined in the SLA and determining deviations</strong>, and <strong>on identifying deviations the concerned parties are notified</strong>. <strong>Accounting</strong> involves <strong>capturing and archiving SLA adherence for compliance</strong>, reporting the application's actual performance against the guaranteed performance, and stating <strong>the frequency and duration of each breach together with the penalties paid for each violation</strong>. <strong>Enforcement</strong> is <strong>taking appropriate action when runtime monitoring detects a violation</strong> &mdash; notifying parties, charging penalties and so on. Policies can be expressed <strong>using a subset of the Common Information Model (CIM)</strong>, an open standard for expressing managed elements of a data centre through relationships and common objects.</td></tr>
<tr><td><strong>5. De-commissioning</strong></td><td><strong>Termination of all activities performed under a particular SLA when the hosting relationship between provider and consumer has ended.</strong> The SLA <strong>specifies the terms and conditions of contract termination and the situations under which the relationship can be considered legally ended</strong>.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch8/lecturenote-ch-8-s20-154.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch8/lecturenote-ch-8-s20-154.webp" alt="Diagram from LectureNote_Ch _8.pptx, slide 20" width="1040" height="569" loading="lazy" decoding="async">
<figcaption><strong>slide 20</strong> &middot; LectureNote_Ch _8.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch8/lecturenote-ch-8-s21-155.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch8/lecturenote-ch-8-s21-155.webp" alt="Diagram from LectureNote_Ch _8.pptx, slide 21" width="1086" height="622" loading="lazy" decoding="async">
<figcaption><strong>slide 21</strong> &middot; LectureNote_Ch _8.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<h3>8.3.4 The five phases of SLA management in the cloud</h3>
<p>Where 8.3.3 is the life of the contract, this is the life of <strong>the hosted application</strong> under it. This distinction is exactly the kind of thing a question tests:</p>

<table class="comparison-table">
<thead>
<tr><th>Phase</th><th>What happens</th></tr>
</thead>
<tbody>
<tr><td><strong>1. Feasibility</strong></td><td><strong>The managed service provider conducts a feasibility study of hosting the application on its cloud platform</strong>, covering three kinds of feasibility &mdash; <strong>technical, infrastructure and financial</strong>. Technical feasibility means determining the <strong>ability of the application to scale out</strong>, its <strong>compatibility with the cloud platform in the provider's data centre</strong>, the <strong>need and availability of specific hardware and software</strong> required to host and run it, and <strong>preliminary information about the application's performance and whether it can be met</strong>.</td></tr>
<tr><td><strong>2. On-boarding</strong></td><td><strong>Once customer and provider agree in principle on the basis of the feasibility study, the application is moved from the customer's servers to the hosting platform &mdash; this is called on-boarding.</strong> As part of it, <strong>the provider understands the application's runtime characteristics using runtime profilers</strong>, which <strong>helps identify the SLAs that can be offered</strong> and <strong>create the policies (rule sets) required to guarantee the SLOs mentioned in the application SLA</strong>. <strong>The application becomes accessible to its end users only after on-boarding is complete.</strong></td></tr>
<tr><td><strong>3. Pre-production</strong></td><td><strong>The application is hosted in a simulated production environment</strong>, which <strong>lets the customer verify and validate the provider's findings on runtime characteristics and agree on the defined SLA</strong>. Once both parties agree on cost and terms, <strong>the customer signs off</strong>, and on successful completion <strong>the provider allows the application to go live</strong>.</td></tr>
<tr><td><strong>4. Production</strong></td><td><strong>The application is made accessible to its end users under the agreed SLA.</strong> Situations can arise where the application behaves differently and causes a sustained breach, or the customer requests new terms. <strong>If the SLA is breached frequently, or the customer requests a new non-agreed SLA, the on-boarding process is performed again</strong> &mdash; in the first case to re-analyse the application and its policies, in the second to formulate a new set of policies for the fresh terms.</td></tr>
<tr><td><strong>5. Termination</strong></td><td><strong>When the customer wishes to withdraw the hosted application the data is transferred back to the customer and only essential information is retained for legal compliance.</strong> This ends the hosting relationship for that application, and <strong>the customer's sign-off is obtained</strong>.</td></tr>
</tbody>
</table>
<!-- dcc-fig:ch8/lecturenote-ch-8-s22-156.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch8/lecturenote-ch-8-s22-156.webp" alt="Diagram from LectureNote_Ch _8.pptx, slide 22" width="930" height="297" loading="lazy" decoding="async">
<figcaption><strong>slide 22</strong> &middot; LectureNote_Ch _8.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch8/lecturenote-ch-8-s22-157.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch8/lecturenote-ch-8-s22-157.webp" alt="Diagram from LectureNote_Ch _8.pptx, slide 22" width="1073" height="448" loading="lazy" decoding="async">
<figcaption><strong>slide 22</strong> &middot; LectureNote_Ch _8.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch8/lecturenote-ch-8-s23-158.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch8/lecturenote-ch-8-s23-158.webp" alt="Diagram from LectureNote_Ch _8.pptx, slide 23" width="1084" height="342" loading="lazy" decoding="async">
<figcaption><strong>slide 23</strong> &middot; LectureNote_Ch _8.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<div class="concept-box tip">
<h4>Two lists of five, and how to keep them apart in an exam</h4>
<p><strong>SLA life cycle</strong> = contract definition &rarr; publishing and discovery &rarr; negotiation &rarr; operationalization &rarr; de-commissioning. <em>These are steps the contract takes.</em><br>
<strong>SLA management in the cloud</strong> = feasibility &rarr; on-boarding &rarr; pre-production &rarr; production &rarr; termination. <em>These are steps the application takes.</em><br>
If a question says "explain the SLA life cycle", give the first; if it says "explain SLA management", give the second; if it says "explain SLA in cloud computing", give the definition and criteria from 8.3.1 and 8.3.2 and then both lists as the two applications of it.</p>
</div>
<!-- dcc-fig:ch8/lecturenote-ch-8-s23-159.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch8/lecturenote-ch-8-s23-159.webp" alt="Diagram from LectureNote_Ch _8.pptx, slide 23" width="1058" height="246" loading="lazy" decoding="async">
<figcaption><strong>slide 23</strong> &middot; LectureNote_Ch _8.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<!-- dcc-fig:ch8/lecturenote-ch-8-s24-160.webp -->
<figure class="figure-wrap">
<img class="figure wide slide" src="assets/dcc-slides/ch8/lecturenote-ch-8-s24-160.webp" alt="Diagram from LectureNote_Ch _8.pptx, slide 24" width="1064" height="628" loading="lazy" decoding="async">
<figcaption><strong>slide 24</strong> &middot; LectureNote_Ch _8.pptx</figcaption>
</figure>
<!-- /dcc-fig -->
<h2>8.4 Cloud vulnerabilities and risk mitigation</h2>

<p>This is the reference sheet the course supplies as a table, and it is the most directly examinable material in the unit &mdash; eight vulnerabilities, eight control areas, and one summary principle.</p>

<h3>8.4.1 The eight common vulnerabilities</h3>
<table class="comparison-table">
<thead>
<tr><th>Vulnerability</th><th>Description</th></tr>
</thead>
<tbody>
<tr><td><strong>Data breaches</strong></td><td><strong>Unauthorized access to sensitive data due to misconfigured storage, weak access controls, or poor encryption.</strong> The example given is a <strong>publicly accessible object storage exposing customer records</strong> &mdash; which is Unit 7's bucket with the wrong policy attached.</td></tr>
<tr><td><strong>Insecure APIs</strong></td><td><strong>Weak authentication/authorisation or improper input validation in management APIs</strong>, which can be exploited for <strong>data exposure and privilege escalation</strong>. Every cloud service is an API (Unit 7.3.4), so the API surface <em>is</em> the attack surface.</td></tr>
<tr><td><strong>Misconfigurations</strong></td><td><strong>Human errors</strong> &mdash; <strong>overly permissive buckets, open security groups, weak firewall rules</strong> &mdash; which <strong>often lead to accidental exposure</strong>. Note that this is a <em>human</em> category, not a technical one.</td></tr>
<tr><td><strong>Account hijacking</strong></td><td><strong>Compromised credentials (phishing, brute force, token theft) enable attackers to abuse resources or exfiltrate data.</strong></td></tr>
<tr><td><strong>DoS / DDoS</strong></td><td><strong>Volumetric or application-layer attacks overwhelm services, causing downtime and unexpected scaling costs.</strong> The second half is the cloud-specific part: because capacity is elastic, an attack can be <em>billed to the victim</em> as well as disruptive.</td></tr>
<tr><td><strong>Insider threats</strong></td><td><strong>Malicious or negligent insiders misuse legitimate access; hard to detect without strong monitoring and least privilege.</strong> This is the "trustworthiness of system administrators" from 8.1.3.</td></tr>
<tr><td><strong>Shared technology risks</strong></td><td><strong>Multi-tenant infrastructure and hypervisor flaws may enable cross-tenant attacks if not patched and isolated properly.</strong> This is Unit 6.1.11's statement of the same threat: <strong>malicious software can run on the same server, attack the hypervisor, and access or obstruct other VMs</strong> &mdash; and NoHype is the research response to it.</td></tr>
<tr><td><strong>Compliance / legal risks</strong></td><td><strong>Data residency and regulatory requirements (GDPR, HIPAA) may be violated due to improper region selection or lack of controls.</strong> This is why Unit 7.3.5's regions and zones are a compliance decision and not only a latency one.</td></tr>
</tbody>
</table>

<h3>8.4.2 The eight mitigation control areas</h3>
<table class="comparison-table">
<thead>
<tr><th>Control area</th><th>Practices</th></tr>
</thead>
<tbody>
<tr><td><strong>Data security</strong></td><td><strong>Encrypt data in transit and at rest; manage keys with KMS/HSM; apply tokenisation and anonymisation for sensitive fields.</strong></td></tr>
<tr><td><strong>Identity &amp; access management</strong></td><td><strong>Enforce least privilege; MFA for all users; short-lived credentials; RBAC/ABAC; periodic access reviews; deny-by-default.</strong> &mdash; the concrete practices behind 8.2's five functions.</td></tr>
<tr><td><strong>Secure APIs</strong></td><td><strong>Use OAuth 2.0 / JWT; validate inputs and outputs; apply rate limiting and a WAF; log and monitor all API calls.</strong></td></tr>
<tr><td><strong>Configuration management</strong></td><td><strong>Continuous posture management (AWS Config, Azure Defender, GCP SCC); vulnerability scans; infrastructure-as-code with policy-as-code and pre-deployment checks.</strong> &mdash; the direct answer to misconfiguration.</td></tr>
<tr><td><strong>Threat detection &amp; monitoring</strong></td><td><strong>Centralised logging and SIEM; anomaly detection; alerting on high-risk events; EDR for workloads.</strong></td></tr>
<tr><td><strong>Resilience to DoS/DDoS</strong></td><td><strong>CDN and Anycast; autoscaling; managed DDoS protection; WAF rules for layer 7; rate limiting and surge protection.</strong></td></tr>
<tr><td><strong>Vendor &amp; shared responsibility</strong></td><td><strong>Select certified providers (ISO 27001, SOC 2, FedRAMP); understand shared responsibilities; review SLAs and audit reports.</strong></td></tr>
<tr><td><strong>Training &amp; awareness</strong></td><td><strong>Regular security training; phishing simulations; secure coding programmes; incident response drills.</strong></td></tr>
</tbody>
</table>

<h3>8.4.3 The shared responsibility model, and the summary principle</h3>
<div class="concept-box key">
<h4>The sentence to end a security answer with</h4>
<p><strong>Cloud platforms introduce unique risks, but a layered defence &mdash; encryption, strong IAM, secure APIs, continuous monitoring, configuration governance, DDoS resilience, vendor diligence and staff training &mdash; reduces exposure and supports compliance. Align controls to the shared responsibility model and your regulatory context.</strong></p>
<p>The <strong>shared responsibility model</strong> is the division of duty: the provider is responsible for the security <em>of</em> the cloud (the physical facility, the hardware, the hypervisor and the managed services underneath), and the customer is responsible for security <em>in</em> the cloud (their configuration, identities, data and code). It explains why <strong>misconfiguration and insecure APIs are the customer's fault even though the platform is the provider's</strong>: the provider secured the facility and the hypervisor, and left the bucket policy to whoever set it. That is exactly why the vendor control area says <strong>understand shared responsibilities</strong> and why the auditor actor from Unit 6.3.2 exists.</p>
</div>

<h3>8.4.4 How the four sub-topics fit one answer</h3>
<p>A long security question is easiest to structure as a chain, and each link is already covered above:</p>
<ol>
<li><strong>The risks</strong> &mdash; the eight vulnerabilities in 8.4.1, and the four data states' exposures in 8.1.1.</li>
<li><strong>The data's own obligations</strong> &mdash; privacy and PII, retention, destruction, and the life cycle in 8.1.5; compliance and residency, including the region decision.</li>
<li><strong>The controls</strong> &mdash; the eight control areas in 8.4.2, with IAM from 8.2 as the identity control and encryption as the data control.</li>
<li><strong>The assurance</strong> &mdash; the SLA in 8.3, with its security-and-privacy criterion, its breach and penalty machinery, and the auditor who verifies it.</li>
<li><strong>The division of duty</strong> &mdash; the shared responsibility model, and de-perimeterisation from Unit 5.4.5 to explain why the boundary moved in the first place.</li>
</ol>

<p>The chain is easier to trust once it has been run against the paper's actual question, so here it is worked. <em>"Briefly describe two challenges in ensuring security in cloud environments"</em> wants two, described, not eight named &mdash; and the two that carry the most marks from this unit are <strong>shared responsibility</strong> and <strong>shared technology</strong>, because both are cloud-specific rather than general security.</p>

<p>For <strong>shared responsibility</strong> the description has four moves: the boundary between provider and customer is <em>drawn differently for each service model</em> &mdash; the customer manages more in IaaS than in SaaS &mdash; the boundary is <em>not always visible</em>, so a customer may believe a control exists when it is theirs to provide or the reverse, which is why breaches so often trace to a misconfiguration rather than to a broken control. Then close with the two consequences that make it a challenge rather than a division of labour: <strong>compliance and audit require knowing which side of the line each control sits on</strong>, and the provider can only <em>certify</em> its own side. For <strong>shared technology</strong> the four moves are the mechanism, the consequence, the example and the response: the multi-tenant layer is shared by design (hypervisor, kernel, hardware), so a flaw in it is a flaw in everyone's isolation; Meltdown is the course's example; and the response is hardening and patching rather than prevention, with the risk <strong>mitigated rather than removed</strong>.</p>

<h3>8.4.5 The two challenges in the exam answer</h3>
<table class="comparison-table">
<thead>
<tr><th>Challenge</th><th>Why it is a <em>cloud</em> challenge, and what mitigates it</th></tr>
</thead>
<tbody>
<tr><td><strong>1. Multi-tenancy and shared technology</strong></td><td>Several tenants share hardware and a hypervisor, so <strong>a hypervisor flaw can enable cross-tenant attacks</strong> (Unit 6.1.11: malicious software on the same server can attack the hypervisor and access or obstruct other VMs), and <strong>data from many companies being centralised makes the collection an attractive target</strong>, which also raises the importance of physical security and administrator trustworthiness (8.1.3). <em>Mitigation:</em> patching and isolation, least privilege, continuous monitoring, and provider certification.</td></tr>
<tr><td><strong>2. Data confidentiality and the limits of control</strong></td><td>The customer loses control of where data is and who can see it: <strong>data-at-rest is generally not encrypted because it is commingled with other users' data</strong>; governments may search data depending on where it resides; retention and destruction are governed by the provider's policy as much as the customer's, and <strong>replication makes proof of destruction hard</strong>. <em>Mitigation:</em> encryption in transit and at rest with managed keys, tokenisation, residency-aware region selection, contractual retention and deletion terms in the SLA, and audit.</td></tr>
</tbody>
</table>
<p>Those two are also the deck's own top-of-list challenges from Unit 5.2.4 &mdash; <strong>data confidentiality and auditability, described as a serious problem</strong>, and <strong>security and confidentiality as a major concern for sensitive applications such as healthcare</strong> &mdash; so they are safe choices. <strong>Account hijacking</strong> and <strong>misconfiguration</strong> are equally acceptable if answered with the same structure: name the mechanism, say why the cloud makes it worse, and give the control.</p>

<div class="concept-box tip">
<h4>The paper-facing part of this unit</h4>
<p>Everything in this unit that is written to be answered in the exam &mdash; what each question asks for, and the model answer to it &mdash; is collected in <a href="#/ch/8/past">Past Questions</a>. Read this tab for the subject; switch to that one when you sit down to answer a question.</p>
</div>
`,

  pastSummary: `<h2>Exam-facing summary</h2>
<table class="comparison-table">
<thead>
<tr><th>If the question says&hellip;</th><th>Give&hellip;</th></tr>
</thead>
<tbody>
<tr><td>Explain data security in the cloud</td><td>The four aspects &mdash; data-in-transit (secured protocol, or encryption over a non-secured one, with confidentiality and integrity), data-at-rest (generally not encrypted because data is commingled; the indexing, homomorphic and predicate encryption questions), processing including multitenancy (data must be readable to be computed on), and data lineage (when and where, with the AWS d1/t1/endpoint example).</td></tr>
<tr><td>What is data provenance?</td><td>Computational accuracy as well as data integrity &mdash; the financial calculation example, the exchange-rate and location questions, and how a customer or auditor would verify the answer.</td></tr>
<tr><td>Discuss data privacy</td><td>The definition (varies by jurisdiction, so a concise definition is elusive; about collection, use, disclosure, storage and destruction of PII; accountability and transparency), then the five concerns with their questions: storage, retention, destruction, auditing/monitoring/risk management, and privacy breaches.</td></tr>
<tr><td>Explain compliance / the data life cycle</td><td>Personal information managed as part of organisational data, with cloud impact assessed per phase: generation, transformation, transfer, use, storage, archival, destruction (Fig 8.1).</td></tr>
<tr><td>What is IAM?</td><td>A framework of policies and technologies ensuring the right individuals get the right access to the right resources, with the five core functions and their details; then the four reasons it matters in the cloud &mdash; the dynamic trust boundary extending into the provider's domain, diverse user populations and increased demand for authentication, higher-assurance authentication outside the firewall with the limits of passwords, and authentication from mobile devices.</td></tr>
<tr><td>Explain the SLA</td><td>The definition (service contract; minimum guaranteed level and target level; performance metrics and service objectives; the legal terms binding continual service), the five criteria (availability, performance, disaster recovery, problem resolution, security and privacy of data), and then either the life cycle (contract definition, publishing and discovery, negotiation, operationalization, de-commissioning) or SLA management (feasibility, on-boarding, pre-production, production, termination) as the question requires.</td></tr>
<tr><td>Describe two challenges in ensuring cloud security (4 marks)</td><td>The two rows in 8.4.5 with mechanism, why the cloud worsens it, and the mitigation &mdash; or any two of the eight vulnerabilities with the same structure.</td></tr>
<tr><td>Cloud vulnerabilities and risk mitigation</td><td>The eight vulnerabilities in 8.4.1 and the eight control areas in 8.4.2, then the summary principle and the shared responsibility model.</td></tr>
</tbody>
</table>


`,

  quiz: [
    {
      q: 'Which statement about data-at-rest in the cloud does the course material make?',
      options: [
        'It is always encrypted by the provider',
        'It is generally not encrypted, since data is commingled with other users\' data',
        'It cannot be encrypted under any circumstances',
        'It is encrypted only when in transit as well'
      ],
      answer: 1,
      explanation: 'The deck states that data-at-rest is generally not encrypted because it is commingled with other users\' data, then raises the follow-on questions — encryption when the data is not associated with applications, and the effect on indexing and searching, with homomorphic and predicate encryption as the possible answers.'
    },
    {
      q: 'What is data lineage used for?',
      options: [
        'Compressing data before storage',
        'Knowing when and where data was located within the cloud, for audit and compliance purposes',
        'Encrypting data at rest',
        'Measuring the throughput of an SLA'
      ],
      answer: 1,
      explanation: 'The deck\'s AWS example records each step as a data identifier, a timestamp and an endpoint: store <d1, t1, ex1.s3.amazonaws.com>, process <d2, t2, ec2.compute2.amazonaws.com>, restore <d3, t3, ex2.s3.amazonaws.com>.'
    },
    {
      q: 'Data provenance extends lineage to include:',
      options: [
        'Only the physical location of the disk',
        'Computational accuracy as well as data integrity',
        'The billing history of the account',
        'The encryption key rotation schedule'
      ],
      answer: 1,
      explanation: 'The deck\'s example: a financial calculation that is correct assuming US dollars raises the questions of exchange rates, where the system was located, what state that physical system was in, and how a customer or auditor would verify it. Integrity of data is not integrity of computation.'
    },
    {
      q: 'Why does the deck say that data destruction in the cloud is difficult to prove?',
      options: [
        'Because providers refuse to delete data',
        'Because providers usually replicate data across multiple systems and sites, so you cannot know whether additional copies were retained',
        'Because deletion is illegal in some jurisdictions',
        'Because encrypted data cannot be deleted'
      ],
      answer: 1,
      explanation: 'The replication that gives cloud storage its availability is what makes proof of destruction hard: how do you know the provider did not retain additional copies, did it really destroy the data or merely make it inaccessible, and is it keeping the information longer to mine it?'
    },
    {
      q: 'Which is a core function of IAM as listed in the course material?',
      options: [
        'Compression',
        'Authentication, authorization, user management, policy enforcement and auditing',
        'Backup and recovery only',
        'Network routing'
      ],
      answer: 1,
      explanation: 'IAM is a framework of policies and technologies ensuring that the right individuals get the right access to the right resources, with those five core functions: authentication (verifying identity, e.g. username/password or MFA), authorization (permissions and actions), user management (accounts, groups, roles), policy enforcement and audit/compliance logging.'
    },
    {
      q: 'Why does the organisation\'s trust boundary matter so much in cloud IAM?',
      options: [
        'Because it becomes static and easier to define',
        'Because it becomes dynamic and moves beyond the organisation\'s control, extending into the service provider domain',
        'Because it removes the need for authentication',
        'Because it eliminates the limits of password authentication'
      ],
      answer: 1,
      explanation: 'That is the first of the deck\'s reasons why IAM is important: once the boundary extends into the provider\'s domain, location inside a firewall stops being a security property, and identity becomes the control.'
    },
    {
      q: 'Which is NOT one of the reasons the deck gives for the importance of IAM in cloud?',
      options: [
        'Managing access for diverse user populations such as employees, contractors and partners',
        'The need for higher-assurance authentication, because authentication in the cloud may mean authentication outside the firewall',
        'The need for authentication from mobile devices',
        'The removal of the need for auditing'
      ],
      answer: 3,
      explanation: 'Auditing remains a core IAM function. The reasons are the dynamic trust boundary, diverse user populations with increased demand for authentication (personal, financial and medical data, and cloud applications requiring access control), higher-assurance authentication with the limits of password authentication, and authentication from mobile devices.'
    },
    {
      q: 'An SLA specifies service levels as:',
      options: [
        'A single guaranteed level',
        'A minimum level of service guaranteed and a target level',
        'Only the price of the service',
        'Only the uptime percentage'
      ],
      answer: 1,
      explanation: 'An SLA is the service contract with the provider, giving a level of service for each service as a minimum guaranteed level and a target level, with a number of performance metrics and corresponding service objectives — and, legally, the terms and conditions binding the provider to provide services continually.'
    },
    {
      q: 'Which of these are the five SLA criteria?',
      options: [
        'Availability, performance, disaster recovery, problem resolution, security and privacy of data',
        'Price, region, instance type, storage class, support plan',
        'Authentication, authorization, auditing, retention, destruction',
        'Generation, transformation, transfer, storage, destruction'
      ],
      answer: 0,
      explanation: 'Availability (percentage of time the service is guaranteed to be available), performance (response time, throughput), disaster recovery (mean time to recover), problem resolution (process to identify problems, support options, resolution expectations) and security and privacy of data (mechanisms for security of data in storage and transmission).'
    },
    {
      q: 'What are the five phases of the SLA life cycle, in order?',
      options: [
        'Feasibility, on-boarding, pre-production, production, termination',
        'Contract definition, publishing and discovery, negotiation, operationalization, de-commissioning',
        'Generation, transformation, transfer, storage, destruction',
        'Design, build, test, deploy, retire'
      ],
      answer: 1,
      explanation: 'The SLA life cycle runs contract definition → publishing and discovery → negotiation → operationalization → de-commissioning. Feasibility, on-boarding, pre-production, production and termination are the five phases of SLA <em>management</em> in the cloud — a different list about the application rather than the contract.'
    },
    {
      q: 'In the SLA life cycle, what happens during operationalization?',
      options: [
        'The provider advertises its service offerings in a catalog',
        'SLA monitoring, accounting and enforcement',
        'The application is moved to the hosting platform',
        'The contract terms are negotiated'
      ],
      answer: 1,
      explanation: 'Operation consists of monitoring (measuring parameters, calculating metrics, determining and notifying deviations), accounting (capturing and archiving SLA adherence, reporting actual against guaranteed performance, and recording breach frequency, duration and penalties paid) and enforcement (notifying parties, charging penalties). Policies can be expressed using a subset of the Common Information Model (CIM).'
    },
    {
      q: 'In SLA management in the cloud, what is on-boarding?',
      options: [
        'Advertising the service in a catalog',
        'Moving the application from the customer\'s servers to the hosting platform, and profiling its runtime characteristics to identify the SLAs that can be offered',
        'Signing the final contract',
        'Terminating the relationship and returning the data'
      ],
      answer: 1,
      explanation: 'On-boarding moves the application to the provider\'s platform and uses runtime profilers to understand its characteristics, which helps identify the offerable SLAs and create the policies needed to guarantee the SLOs. The application becomes accessible to end users only after on-boarding completes.'
    },
    {
      q: 'Which mitigation practice belongs to the "Configuration management" control area?',
      options: [
        'Multi-factor authentication for all users',
        'Continuous posture management, vulnerability scans, and infrastructure-as-code with policy-as-code and pre-deployment checks',
        'CDN and Anycast',
        'Phishing simulations'
      ],
      answer: 1,
      explanation: 'Configuration management covers continuous posture management (AWS Config, Azure Defender, GCP SCC), vulnerability scans and IaC with policy-as-code and pre-deployment checks — the direct answer to the misconfiguration vulnerability. MFA belongs to IAM, CDN/Anycast to DDoS resilience, and phishing simulations to training and awareness.'
    },
    {
      q: 'Why is DDoS described as costing the victim money as well as causing downtime in the cloud?',
      options: [
        'Because providers charge a fine for attacks',
        'Because elastic capacity scales up in response to the attack, causing unexpected scaling costs',
        'Because the provider bills for bandwidth only during attacks',
        'Because the SLA guarantees no downtime'
      ],
      answer: 1,
      explanation: 'The reference sheet describes DoS/DDoS as volumetric or application-layer attacks that overwhelm services, causing downtime and unexpected scaling costs — the second half being cloud-specific, because autoscaling responds to the attack. Mitigations include CDN and Anycast, managed DDoS protection, layer-7 WAF rules, rate limiting and surge protection.'
    },
    {
      q: 'Which vulnerability involves human error such as overly permissive buckets, open security groups and weak firewall rules?',
      options: [
        'Account hijacking',
        'Misconfigurations',
        'Insider threats',
        'Insecure APIs'
      ],
      answer: 1,
      explanation: 'Misconfiguration is the human category, and it is the most common route to accidental exposure. Configuration management with posture management, policy-as-code and pre-deployment checks is the matching control area.'
    },
    {
      q: 'What does the shared responsibility model divide?',
      options: [
        'The cost between provider and customer',
        'Security of the cloud (provider) from security in the cloud (customer)',
        'The SLA penalties between the parties',
        'The data between regions'
      ],
      answer: 1,
      explanation: 'The provider is responsible for the physical facility, hardware, hypervisor and managed services underneath; the customer is responsible for their configuration, identities, data and code. It is why misconfiguration and insecure APIs remain the customer\'s responsibility even though the platform belongs to the provider — and why the control list says to understand shared responsibilities.'
    },
    {
      q: 'Why are shared technology risks a cloud-specific concern?',
      options: [
        'Because all tenants use the same password',
        'Because multi-tenant infrastructure and hypervisor flaws may enable cross-tenant attacks if not patched and isolated properly',
        'Because tenants share the same data by default',
        'Because providers publish their hypervisor source code'
      ],
      answer: 1,
      explanation: 'It is the same threat Unit 6.1.11 states from the virtualization side: malicious software can run on the same server, attack the hypervisor and access or obstruct other VMs. Mitigations are patching, isolation, least privilege, continuous monitoring and provider certification.'
    },
    {
      q: 'A publicly accessible object storage bucket exposing customer records is the example given for which vulnerability?',
      options: [
        'Data breaches',
        'Compliance or legal risk',
        'DoS',
        'Insider threats'
      ],
      answer: 0,
      explanation: 'Data breaches are defined as unauthorized access to sensitive data due to misconfigured storage, weak access controls or poor encryption, with a publicly accessible object storage exposing customer records as the example — which is the misconfiguration category producing a breach, and why the categories overlap in practice.'
    }
  ],

  past: [
    {
      year: '2025 (expected)',
      marks: '6',
      repeats: 1,
      q: 'Discuss Data Privacy concerns in cloud computing.',
      occ: [
        { year: '2025 (expected)', marks: '6', q: 'Discuss Data Privacy concerns in cloud computing.' }
      ],
      answer: `
<h4>Model answer &mdash; 6 marks</h4>
<p>Privacy is the subset of security that is about <em>other people's</em> data and about the law,
and that is the distinction worth opening with: a security breach can be a privacy breach, but
privacy also covers what is lawfully done with data that never leaked.</p>
<ul>
<li><strong>Where the data physically is (data residency and sovereignty)</strong> &mdash; in a
cloud, storage location is a provider decision, and many jurisdictions require certain personal
data to remain inside their borders. An architecture that spans regions without a residency
policy can be unlawful without anyone doing anything wrong.</li>
<li><strong>The shared responsibility gap</strong> &mdash; the provider secures the infrastructure
and the customer secures the data, but the regulator holds the customer &mdash; as data
controller &mdash; accountable for both. This is the concern that catches most organisations.</li>
<li><strong>Multi-tenancy and the risk of exposure</strong> &mdash; shared hardware means a
misconfiguration or a side channel can expose one tenant's data to another, and the customer
cannot audit the isolation themselves.</li>
<li><strong>Secondary use and the training of models</strong> &mdash; data stored or processed by
third-party services may be used for provider analytics or to improve its models unless
contractually excluded. Privacy asks not only “is it safe” but “what else will it
be used for”.</li>
<li><strong>The right to erasure under multi-tenancy</strong> &mdash; deletion must reach
replicas, backups and caches, and proving that it did is genuinely hard in a distributed store,
which the unit's security deck treats as a problem in its own right.</li>
<li><strong>Access control and auditability</strong> &mdash; who inside the organisation can read
the data, and is there a record of who did.</li>
</ul>
<div class="concept-box tip">
<h4>Marking this one</h4>
<p>Predicted &mdash; from the previous site's “Teacher Notes / 2025 Expected” set, 6
marks. Residency, the responsibility gap and erasure are the three that are specific to the
cloud rather than to computing in general; an answer made of generic privacy concerns without
them reads as prepared for a different subject.</p>
</div>
`
    },
    {
      year: '2025 (expected)',
      marks: '6',
      repeats: 1,
      q: 'Explain Identity and Access Management (IAM) in cloud computing.',
      occ: [
        { year: '2025 (expected)', marks: '6', q: 'Explain Identity and Access Management (IAM) in cloud computing.' }
      ],
      answer: `
<h4>Model answer &mdash; 6 marks</h4>
<p><strong>IAM</strong> is the service that answers two questions for every request to a cloud
resource: <em>who is this</em> (authentication) and <em>what are they allowed to do</em>
(authorisation). Everything else in cloud security is built on its answers.</p>
<p><strong>What it is made of.</strong></p>
<ul>
<li><strong>Identity</strong> &mdash; a user, a group, or a machine identity (a service account or
an IAM role). The last of these matters most in a cloud, because workloads need credentials too.</li>
<li><strong>Policy</strong> &mdash; a document saying which actions on which resources are allowed
or denied to which principal. A <em>role</em> is a policy bundle that can be assumed temporarily.</li>
<li><strong>Federation and SSO</strong> &mdash; identities from an external directory (SAML, OIDC)
are trusted, so the company keeps one identity store and the cloud consumes it rather than
duplicating accounts.</li>
<li><strong>MFA</strong> &mdash; a second factor on every privileged action, which is the single
cheapest control against credential theft.</li>
</ul>
<p><strong>The principle to state explicitly: least privilege.</strong> A principal gets the
minimum permission needed for its task and nothing more, and temporary credentials are preferred
to long-lived keys. The cloud makes this more urgent than a single server does, because one
compromised administrative identity reaches every service in the account.</p>
<div class="concept-box tip">
<h4>Marking this one</h4>
<p>Predicted &mdash; from the previous site's “Teacher Notes / 2025 Expected” set, 6
marks. The two halves are the definition (authentication and authorisation) and the components.
Least privilege is the sentence that shows you understand why it exists rather than only what it
contains.</p>
</div>
`
    },
    {
      year: '2025 (expected)',
      marks: '8',
      repeats: 1,
      q: 'Discuss risk mitigation strategies for securing cloud environments.',
      occ: [
        { year: '2025 (expected)', marks: '8', q: 'Discuss risk mitigation strategies for securing cloud environments.' }
      ],
      answer: `
<h4>Model answer &mdash; 8 marks</h4>
<p>Each strategy answers one of the vulnerabilities above, and that pairing is the structure:</p>
<ul>
<li><strong>Identity and access management done first</strong> &mdash; least privilege, roles
rather than long-lived keys, MFA on every privileged account, and no shared credentials. This
is the single highest-value control because most breaches arrive through a credential.</li>
<li><strong>Encryption in transit and at rest, with key management</strong> &mdash; TLS between
everything, and provider-managed or customer-managed keys for stored data, so a stolen volume
is not a stolen dataset.</li>
<li><strong>Configuration baseline and continuous auditing</strong> &mdash; a hardened template,
then automated checks against it, because the failure mode is drift after the fact rather than
a decision at the start.</li>
<li><strong>Network segmentation</strong> &mdash; private subnets, security groups that deny by
default, and no data store reachable directly from the internet.</li>
<li><strong>Monitoring, logging and alerting</strong> &mdash; centralised audit logs with
detection rules. This is also the detection half of the answer: the controls above reduce the
probability, and this reduces the time to notice.</li>
<li><strong>Backups and tested restore</strong> &mdash; the only reliable answer to ransomware and
to accidental deletion, and a backup that has never been restored is not yet a control.</li>
<li><strong>Provider-side and contractual controls</strong> &mdash; the SLA, the audit rights, the
certifications (ISO 27001, SOC 2) and a documented shared-responsibility split. This is the
part the customer cannot do technically and must do contractually.</li>
<li><strong>People and process</strong> &mdash; training, an incident-response plan and a
disaster-recovery plan, because the controls are operated by humans under time pressure.</li>
</ul>
<div class="concept-box tip">
<h4>Marking this one</h4>
<p>Predicted &mdash; from the previous site's “Teacher Notes / 2025 Expected” set, 8
marks. Eight strategies is a mark each; an answer with four and a lot of prose about them is a
half answer. Group them as <em>prevent</em>, <em>detect</em>, <em>recover</em> and
<em>contract</em> and the structure itself carries marks.</p>
</div>
`
    },
    {
      year: '2025 (expected)',
      marks: '8',
      repeats: 1,
      q: 'Identify and explain four common cloud security vulnerabilities.',
      occ: [
        { year: '2025 (expected)', marks: '8', q: 'Identify and explain four common cloud security vulnerabilities.' }
      ],
      answer: `
<h4>Model answer &mdash; 8 marks</h4>
<p>Four vulnerabilities, two marks each: name it, then say why the cloud makes it worse or
easier to reach. The unit's deck lists exactly these.</p>
<ol>
<li><strong>Data breaches and data loss</strong> &mdash; unauthorised access to, or destruction
of, stored data. The cloud makes this worse because the data is reachable over the network
rather than behind a physical door, and because a single misconfigured bucket exposes it to the
whole internet rather than to one office.</li>
<li><strong>Misconfiguration and insecure interfaces</strong> &mdash; the dominant real-world
cause. APIs and consoles are the control surface, so an over-permissive API key or a public
storage bucket is a breach, and self-service means the customer's mistake becomes the
provider's incident. Shared-responsibility is the concept to name here: the provider secures
<em>of</em> the cloud, the customer secures what is <em>in</em> it.</li>
<li><strong>Account and credential compromise</strong> &mdash; stolen keys, weak identity
federation, or a single administrative account. The cloud concentrates privilege: one
compromised root credential reaches every service in the account, which is why IAM and MFA
matter more here than on a single server.</li>
<li><strong>Multi-tenancy and side-channel risk</strong> &mdash; several customers share the same
physical hardware through the hypervisor, so a hypervisor escape or a cache-timing side channel
can cross the tenant boundary. Isolation is only as strong as the hypervisor's, and it is the
risk the customer cannot audit.</li>
</ol>
<p>Two more worth a clause if there is room: <em>insider threat</em> at the provider, and
<em>denial of service</em> against a shared, metered service &mdash; which in a cloud also bills
the victim for the attack.</p>
<div class="concept-box tip">
<h4>Marking this one</h4>
<p>Predicted &mdash; the previous site's “Teacher Notes / 2025 Expected” set, 8 marks,
and the wording says “four”. Four named and explained beats six named and not
explained: the marks are in the explanation, and this is Unit 8's 8-mark unit on the paper, so
it is worth having the four crisp.</p>
</div>
`
    },
    {
      year: 'Model 2025',
      marks: '4',
      repeats: 1,
      q: 'Briefly describe two challenges in ensuring security in cloud environments.',
      occ: [
        { year: 'Model 2025', marks: '4', q: 'Briefly describe two challenges in ensuring security in cloud environments.' }
      ],
      answer: `
<h4>Model answer &mdash; 4 marks</h4>
<p><strong>Challenge 1 &mdash; multi-tenancy and shared technology.</strong> In the cloud <strong>several tenants share the same physical infrastructure and the same hypervisor</strong>, so the isolation between them is provided by software rather than by separate machines. The consequences are <strong>shared technology risks: multi-tenant infrastructure and hypervisor flaws may enable cross-tenant attacks if not patched and isolated properly</strong>. In the virtualization terms of Unit 6, <strong>malicious software can run on the same server, attack the hypervisor, and access or obstruct other VMs</strong> &mdash; which is exactly why the NoHype proposal removes the hypervisor altogether to leave nothing to attack. Centralisation compounds it: <strong>to the extent that quantities of data from many companies are centralised, this collection becomes an attractive target for criminals, and the physical security of the data centre and the trustworthiness of system administrators take on new importance.</strong> One incident can therefore affect many tenants at once, and both the physical facility and the provider's own staff become part of the customer's risk even though neither is under the customer's control.</p>
<p><em>Mitigation:</em> patching and isolation, <strong>least privilege</strong> with deny-by-default, continuous monitoring and logging, and selecting <strong>certified providers (ISO 27001, SOC 2, FedRAMP)</strong> while understanding the shared responsibility model.</p>

<p><strong>Challenge 2 &mdash; data confidentiality and the limits of the customer's control.</strong> Once data is in the cloud, the customer no longer controls where it is or who can see it. <strong>Data-at-rest is generally not encrypted, since data is commingled with other users' data</strong>, and even encrypting it is difficult without losing indexing and searching &mdash; which is why homomorphic and predicate encryption are research areas rather than defaults. For any application to process data, <strong>the data is not encrypted</strong>, so trust in the platform cannot be replaced by cryptography. On top of that, <strong>some governments may decide to search through data without notifying the data owner, depending on where the data resides</strong>; holders must ask <strong>whether the cloud provider itself has any right to see and access customer data</strong>; and <strong>retention and destruction are governed by the provider's policy as much as the customer's</strong> &mdash; and because <strong>providers usually replicate data across multiple systems and sites, it is hard to prove that a copy was really destroyed</strong> rather than merely made inaccessible.</p>
<p><em>Mitigation:</em> <strong>encrypt data in transit and at rest, manage keys with KMS/HSM, and apply tokenisation and anonymisation for sensitive fields</strong>; choose regions with regard to data residency and regulation (GDPR, HIPAA); and put retention and deletion terms, plus breach-notification duties, into the <strong>SLA</strong>, whose criteria include the <strong>mechanisms for security of data in storage and transmission</strong>.</p>

<p><strong>Either way, finish with the principle:</strong> cloud platforms introduce unique risks, but a <strong>layered defence</strong> &mdash; encryption, strong IAM, secure APIs, continuous monitoring, configuration governance, DDoS resilience, vendor diligence and staff training &mdash; reduces exposure and supports compliance, with controls aligned to the <strong>shared responsibility model</strong> and the applicable regulatory context.</p>

<div class="concept-box tip">
<h4>Where this came from</h4>
<p>Group B, question 12 of the <em>Model Question 2025</em>. The wording is <strong>"briefly describe two"</strong>, so two well-structured challenges with a mechanism, a reason the cloud makes it worse, and a mitigation will outscore eight names. Both challenges chosen above are the ones the course material itself flags: Unit 5's deck lists <em>data confidentiality and auditability</em> as "a serious problem" and security as a major concern for sensitive applications such as healthcare, and shared technology risk is stated in both the Chapter 6 deck and the vulnerabilities reference sheet.</p>
</div>`
    }
  ]
};

;
/* ch9.js */
/* Chapter 9 — Emerging Trends in Distributed and Cloud Computing.

   Syllabus unit 9: 4 hours, 4 marks. Sub-topics 9.1 Edge and Fog Computing,
   9.2 Serverless Architecture, 9.3 Kubernetes and Docker, 9.4 Cloud-native and
   Microservices.

   Sourcing note, as for Unit 7: there is no Chapter 9 deck among the shared
   lecture files. What this page is built from:

     * the Chapter 6 deck's container material — the definition of
       containerization, the container engine (Docker Engine), the
       containers-versus-VMs architecture, the pros and cons lists including the
       Meltdown caveat, and the "virtualize the layers above the host OS" idea
       that 9.3 and 9.4 both depend on
     * `books_all_distributed_systems_tanenbaun_p0001-0200.txt` — Tanenbaum and
       Van Steen, a recommended reference, which contains the corpus's only
       discussion of the edge: edge-server systems taken a step further, with
       "additional servers at the edge of the network used to assist in
       computations and storage, essentially leading to distributed cloud
       systems", and then fog computing, where "even end-user devices form part
       of the system and are (partly) controlled by a cloud service provider"
     * the Chapter 7 material on Lambda, managed Kubernetes services (GKE, EKS,
       AKS) and regions, which is where these trends appear as products
     * the syllabus wording itself, and the Model Question 2025's Group C
       question 15, which is answered in 9.4.6

   Where a fact is standard industry vocabulary rather than course material it
   is presented as the term's definition rather than as the teacher's wording,
   so the sourcing stays visible. */

window.CHAPTERS = window.CHAPTERS || {};
window.CHAPTERS[9] = {
  learn: `

<h2>Unit 9 &mdash; Emerging Trends in Distributed and Cloud Computing</h2>
<p class="unit-meta">Syllabus: 4 hours &middot; 4 marks &middot; sub-topics 9.1&ndash;9.4</p>

<div class="concept-box asked">
<h4>What this unit is worth in the exam</h4>
<ul>
<li><strong>8 marks</strong> &mdash; &ldquo;Discuss cloud-native architecture. How do microservices, containers, and orchestration tools like Kubernetes support it? <strong>[4+4]</strong>&rdquo; (<em>Group C, question 15</em> of the Model Question 2025)</li>
</ul>
<p>A 4-mark syllabus unit carrying an 8-mark Group C question, because the question is really about two of its four sub-topics: <strong>9.4 cloud-native and microservices</strong> for the first 4 marks, and <strong>9.3 containers and orchestration</strong> for the second 4. Note the wording of the second half &mdash; <em>how do microservices, containers, and orchestration tools support it</em> &mdash; which asks for one answer per tool, not three descriptions. The 4.4 in 9.4.6 gives exactly that structure.</p>
</div>

<div class="concept-box warn">
<h4>About this unit's sources</h4>
<p><strong>There is no Chapter 9 lecture deck among the shared files.</strong> This page is written from the Chapter 6 deck's container material (which is what 9.3 and 9.4 build on), from Tanenbaum and Van Steen's discussion of edge and fog computing, from the Chapter 7 material on Lambda and managed Kubernetes, and from the syllabus list itself. Definitions of industry terms are given as such. <strong>If a Chapter 9 deck exists, upload it and this page can be rewritten from class material.</strong></p>
</div>

<h2>9.1 Edge and Fog Computing</h2>

<h3>9.1.1 Why computation moved out of the data centre again</h3>
<p>Units 5 to 8 are the story of consolidation: resources pooled, virtualized and rented from large data centres because <strong>information and data processing can be done more efficiently on large farms of computing and storage systems</strong> (Unit 5.1.2). This unit is about the counter-movement, and the reason is physical. When data is produced by devices &mdash; sensors, phones, cameras, vehicles, machines &mdash; sending all of it to a distant data centre and waiting for an answer costs <strong>latency</strong> (the round trip), <strong>bandwidth</strong> (the volume), and sometimes <strong>privacy or legal compliance</strong> (the data leaving a jurisdiction), and it fails entirely when the device is <strong>offline</strong>.</p>

<p>The course's reference on this is Tanenbaum and Van Steen, and the progression it describes is worth quoting because it is the corpus's only statement of the idea. It begins with content at the edge: <strong>servers at the edge can be used for replicating web pages</strong> &mdash; the content-delivery network, which is the oldest form of edge computing. Then: <strong>&ldquo;This concept of edge-server systems is now often taken a step further: taking cloud computing as implemented in a data centre as the core, additional servers at the edge of the network are used to assist in computations and storage, essentially leading to distributed cloud systems.&rdquo;</strong> And finally: <strong>&ldquo;In the case of fog computing, even end-user devices form part of the system and are (partly) controlled by a cloud service provider.&rdquo;</strong></p>

<h3>9.1.2 The three tiers</h3>
<figure class="figure-wide figure-wrap">
<svg class="figure wide" viewBox="0 0 800 360" role="img" aria-label="Three-tier architecture: devices at the edge, fog nodes near the edge, and the cloud data centre at the centre; processing moves toward the data source as latency, bandwidth and privacy pressure increases">
<defs><marker id="f9a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="flow-arrow-head"/></marker></defs>

<text class="flow-label" x="400" y="24" text-anchor="middle">Data is produced at the far left; capacity and scale increase to the right</text>

<rect class="flow-box phase1" x="30" y="60" width="180" height="110" rx="10"/>
<text class="flow-label" x="120" y="82" text-anchor="middle">Edge &mdash; the devices</text>
<text class="flow-label" x="120" y="104" text-anchor="middle">sensors, phones, cameras,</text>
<text class="flow-label" x="120" y="122" text-anchor="middle">vehicles, machines</text>
<text class="flow-label" x="120" y="148" text-anchor="middle">milliseconds &middot; tiny compute</text>

<rect class="flow-box phase2" x="250" y="60" width="220" height="110" rx="10"/>
<text class="flow-label" x="360" y="82" text-anchor="middle">Fog &mdash; nodes near the edge</text>
<text class="flow-label" x="360" y="104" text-anchor="middle">gateways, cell towers, on-premise</text>
<text class="flow-label" x="360" y="122" text-anchor="middle">servers, branch equipment</text>
<text class="flow-label" x="360" y="148" text-anchor="middle">local network latency, shared by many devices</text>

<rect class="flow-box phase3" x="510" y="60" width="260" height="110" rx="10"/>
<text class="flow-label" x="640" y="82" text-anchor="middle">Cloud &mdash; the data centre</text>
<text class="flow-label" x="640" y="104" text-anchor="middle">the elastic pool from Units 5&ndash;7</text>
<text class="flow-label" x="640" y="122" text-anchor="middle">unlimited capacity, global reach</text>
<text class="flow-label" x="640" y="148" text-anchor="middle">tens to hundreds of milliseconds &middot; training, archives, heavy analytics</text>

<path class="flow-arrow" d="M214,115 H246" marker-end="url(#f9a)"/>
<path class="flow-arrow" d="M474,115 H506" marker-end="url(#f9a)"/>
<text class="flow-label" x="230" y="100" text-anchor="middle">pre-aggregated data</text>
<text class="flow-label" x="490" y="100" text-anchor="middle">summaries, models</text>

<path class="flow-arrow" d="M506,168 H246" marker-end="url(#f9a)"/>
<path class="flow-arrow" d="M246,186 H214" marker-end="url(#f9a)"/>
<text class="flow-label" x="376" y="196" text-anchor="middle">model updates and commands</text>
<text class="flow-label" x="376" y="220" text-anchor="middle">the loop that makes the tiers one system rather than three</text>

<text class="flow-label" x="400" y="262" text-anchor="middle">Compute is placed where the latency and bandwidth allow it, and only what must be central is central.</text>
<text class="flow-label" x="400" y="286" text-anchor="middle">Tanenbaum's framing is the useful one: taking the data centre as the core, edge servers assist in computation and</text>
<text class="flow-label" x="400" y="306" text-anchor="middle">storage, leading to distributed cloud systems &mdash; and in fog computing even end-user devices are part of the</text>
<text class="flow-label" x="400" y="326" text-anchor="middle">system and partly controlled by the provider.</text>
</svg>
<figcaption><strong>Fig 9.1 &mdash; Edge, fog and cloud as one system.</strong> The tiers are distinguished by <strong>where the compute sits relative to the data source</strong>, not by what technology they use: an edge node is a device doing something to its own data, a fog node is a shared machine one network hop away, and the cloud is the elastic pool of Units 5&ndash;7. Note that the same control plane spans all three &mdash; which is the hard part, and is 9.1.4.</figcaption>
</figure>

<table class="comparison-table">
<thead>
<tr><th></th><th>Cloud</th><th>Fog</th><th>Edge</th></tr>
</thead>
<tbody>
<tr><td><strong>Where the compute is</strong></td><td>Large, centralised data centres.</td><td>Nodes between the devices and the cloud &mdash; gateways, base stations, on-premise servers.</td><td>In the devices themselves.</td></tr>
<tr><td><strong>Node count and capacity per node</strong></td><td>Few nodes, very large.</td><td>Many nodes, medium.</td><td>Very many nodes, very small.</td></tr>
<tr><td><strong>Latency to the data</strong></td><td>Tens to hundreds of milliseconds; depends on distance and routing.</td><td>Low &mdash; one local network hop, shared among many devices.</td><td>Effectively zero &mdash; the computation is on the device.</td></tr>
<tr><td><strong>Bandwidth sent upward</strong></td><td>Receives raw data if nothing filters it.</td><td>Receives pre-aggregated data from devices.</td><td>Filters, summarises and decides first.</td></tr>
<tr><td><strong>Suited to</strong></td><td>Heavy analytics, model training, archives, long-term storage, global services.</td><td>Coordination between devices, local analytics, caching, filtering, small models.</td><td>Real-time control, safety, offline operation, privacy-sensitive data.</td></tr>
<tr><td><strong>Typical example</strong></td><td>The elastic pool of Units 5&ndash;7.</td><td>A gateway aggregating a factory's sensors; a cell tower hosting content and a small model.</td><td>A car braking on its own sensors; a camera detecting a person without sending video anywhere.</td></tr>
</tbody>
</table>

<h3>9.1.3 What the trends actually buy</h3>
<ul>
<li><strong>Latency</strong> &mdash; a control loop cannot wait for a round trip to another continent. This is the requirement that makes tactile control, autonomous driving and industrial automation impossible in a purely centralised model.</li>
<li><strong>Bandwidth and cost</strong> &mdash; a camera producing megabytes per second cannot send all of it. Filtering at the edge is the difference between sending events and sending video.</li>
<li><strong>Privacy and compliance</strong> &mdash; processing where the data was produced is the simplest way to keep personal or regulated data inside a jurisdiction, which is the data residency problem of Unit 8.1.4 solved by not moving the data.</li>
<li><strong>Availability</strong> &mdash; a device that keeps working without connectivity is a device that keeps working. Centralised designs fail when the network does.</li>
</ul>
<p>And the costs, which a good answer names rather than hides: <strong>many more nodes to manage</strong> (a fleet of devices is not one data centre), <strong>weaker physical security</strong> (a device in the field can be stolen or opened), <strong>updates across a fleet</strong>, and the return of the problems this course has already solved once &mdash; <strong>unit 3's clock synchronisation and coordination</strong>, now between thousands of devices with intermittent connectivity.</p>

<div class="concept-box tip">
<h4>The point that makes edge computing a distributed-systems topic</h4>
<p>Move the compute out of the data centre and you have not simplified the system: you have re-created every problem in this syllabus with less reliable hardware. The devices have <strong>their own clocks</strong> (Unit 3.0), they must <strong>communicate only by passing messages</strong> (Unit 1.1), they experience <strong>partial failure</strong> (Unit 4.1.2's fault tolerance), and the data they hold is <strong>replicated and therefore needs a consistency rule</strong> (Unit 4.1.6). Edge computing is the same discipline applied under harder constraints &mdash; that sentence is worth having ready for a discussion question.</p>
</div>

<h2>9.2 Serverless Architecture</h2>

<h3>9.2.1 What serverless means</h3>
<div class="concept-box key">
<p><strong>Serverless computing is a model in which the provider runs the code and the customer does not provision, size, patch or pay for servers at all.</strong> The name describes the customer's view, not the reality &mdash; there are servers; there are simply none the customer has to think about. It has two halves:</p>
<ul>
<li><strong>FaaS &mdash; Functions as a Service:</strong> event-driven code execution, billed per invocation and per unit of execution time. This is Unit 7.3.3's AWS Lambda, Azure Functions and Google Cloud Functions.</li>
<li><strong>BaaS &mdash; Backend as a Service:</strong> the managed services a function calls instead of running its own &mdash; managed databases, queues, authentication, object storage, notifications. Unit 7.2.3's DBaaS is the same idea for data.</li>
</ul>
</div>

<p>The defining properties follow from the billing model, and each one is a trade:</p>
<table class="comparison-table">
<thead>
<tr><th>Property</th><th>What it means</th><th>What it costs</th></tr>
</thead>
<tbody>
<tr><td><strong>Event-driven</strong></td><td><strong>An event starts the code</strong> &mdash; an HTTP request, a file arriving in object storage, a queue message, a scheduled tick &mdash; and the function ends when it returns.</td><td>Not suited to long-running or continuous work (stream processing with high throughput, for example), because the platform charges per invocation and caps execution time.</td></tr>
<tr><td><strong>No server management</strong></td><td>No operating system to choose, patch, scale or secure.</td><td>Almost no control over the runtime, its version, its libraries or its network behaviour, which confuses debugging and rules out workloads needing a specific kernel.</td></tr>
<tr><td><strong>Automatic, fine-grained scaling</strong></td><td>Scaling is per request; each invocation is independent, so traffic is met by concurrent copies rather than by a machine getting bigger.</td><td>Concurrency limits and the <strong>cold start</strong> problem: after a period of idleness, the first request must wait for the runtime to be initialised.</td></tr>
<tr><td><strong>Pay per use</strong></td><td>Billed per invocation and per execution time, so <strong>nothing running means nothing billed</strong> &mdash; the purest form of 5.2.1's pay-per-usage and 6.4.1's provisioning tension, since the provider absorbs the sizing decision.</td><td>The trade for a steady, high load is poor: an always-busy function is more expensive than a reserved virtual machine doing the same work.</td></tr>
<tr><td><strong>Stateless functions</strong></td><td>State does not persist between invocations, so any data that must outlive a request goes to storage, a database or a queue.</td><td>Requires the application to be written for it, and pushes most of the design into the BaaS services around the function.</td></tr>
</tbody>
</table>

<p><strong>Where it fits in the syllabus.</strong> Serverless is the last step of a progression that runs through the whole course: physical servers you own (Unit 5 on-premises) &rarr; virtual machines you manage (Unit 6, Unit 7's EC2) &rarr; containers you package (Unit 6.2) &rarr; functions you only write (Unit 9.2). Each step moves one more layer of operations to the provider; each step trades control for convenience. Fig 7.1 draws it, and the same trade applies at every step, which is why the exam can ask about any two of them and expect the same reasoning.</p>

<h3>9.2.2 Where serverless is the right answer</h3>
<ul>
<li><strong>Glue between services</strong> &mdash; a file arriving in storage triggers a resize or an index update; a database change triggers a notification.</li>
<li><strong>Scheduled and administrative jobs</strong> &mdash; nightly reports, cleanup, backups: work that runs for minutes a day and would otherwise pay for 24 hours of idle machine.</li>
<li><strong>Sporadic and unpredictable traffic</strong> &mdash; an internal tool, a webhook endpoint, an API used in bursts &mdash; where capacity sized for the peak would sit idle most of the time.</li>
<li><strong>Backend for an event-driven application</strong> &mdash; where each step of a workflow is a function consuming the previous step's event.</li>
</ul>
<p>And where it is the wrong answer: <strong>long-running processes</strong>, <strong>stateful services</strong>, <strong>latency-critical workloads where a cold start is unacceptable</strong>, and <strong>steady high load</strong>, where a reserved instance is cheaper. That list is a more useful exam answer than the benefits list, because it shows the trade was understood.</p>

<h2>9.3 Kubernetes and Docker</h2>

<h3>9.3.1 Docker, from the course's own definition of a container</h3>
<p>This sub-topic is the only one in the unit with real class material behind it. The Chapter 6 deck defines the container as <strong>a unit of software that is lightweight but still bundles the code, its dependencies and the configuration altogether into a single image</strong>, and states the key difference from a virtual machine: <strong>using a containerization engine such as the Docker Engine, containers create several isolated OS environments within the same host system kernel, which can be shared with other containers dedicated to running different functions of the app</strong>, so that <strong>only binaries, libraries and other runtime components are developed or executed separately for each container, which makes them more resource-efficient compared to VMs</strong>.</p>

<p><strong>Docker</strong> is the containerisation engine named in that sentence &mdash; the tool that builds the image, runs it as a container, and moves it between machines. Its vocabulary, all of which falls out of the deck's definition:</p>
<table class="comparison-table">
<thead>
<tr><th>Term</th><th>Meaning</th><th>Where it comes from in the course</th></tr>
</thead>
<tbody>
<tr><td><strong>Image</strong></td><td>The packaged unit: the application's code, its dependencies and its configuration, frozen.</td><td>The deck's "single image" and its <strong>Encapsulation</strong> benefit in 6.1.10 &mdash; a complete computing environment as one artefact.</td></tr>
<tr><td><strong>Container</strong></td><td>A running instance of an image: <strong>an isolated OS environment within the same host system kernel</strong>.</td><td>The container definition in 6.2.2.</td></tr>
<tr><td><strong>Dockerfile</strong></td><td>The recipe that builds the image, so the environment is <strong>reproducible</strong> rather than documented.</td><td>The deck's <strong>portability</strong> benefit: "size, ease of defining a container, versioning".</td></tr>
<tr><td><strong>Registry</strong></td><td>Where images are stored and fetched from, so a build on one machine becomes a deployment on another.</td><td>The deck's <strong>great ecosystem</strong> benefit.</td></tr>
<tr><td><strong>Container engine</strong></td><td>What runs the container &mdash; Docker Engine. Containers can run <strong>on top of bare-metal servers, on top of hypervisors, or in cloud infrastructure</strong>.</td><td>The deck's statement in 6.2.2.</td></tr>
</tbody>
</table>

<h3>9.3.2 Why an orchestrator is needed</h3>
<p>One container on one machine needs Docker. A production system is <strong>dozens or hundreds of containers across many machines</strong>, and at that scale four problems appear that Docker does not solve:</p>
<ol>
<li><strong>Placement</strong> &mdash; which container should run on which node, given the resource requests, the constraints and the current load.</li>
<li><strong>Restarts and self-healing</strong> &mdash; if a container crashes, or the node it is on fails, something must start it again elsewhere.</li>
<li><strong>Scaling</strong> &mdash; adding copies when load rises and removing them when it falls, exactly the elasticity of 5.2.1 expressed as container replicas.</li>
<li><strong>Networking and discovery</strong> &mdash; when containers are created and destroyed constantly, their addresses are not stable, so callers need a name that resolves to whatever is currently healthy.</li>
</ol>
<p><strong>Kubernetes is the orchestrator that solves them</strong>, and its central idea is worth stating precisely: <strong>you declare the desired state and the orchestrator continuously works to make the actual state match it</strong>. That is the same shape as this course's other control mechanisms &mdash; the demand-driven provisioning of 6.4.3 compares a measured value against a threshold and corrects; Kubernetes compares the observed state of the whole cluster against a declared spec and corrects.</p>

<table class="comparison-table">
<thead>
<tr><th>Concept</th><th>What it is</th></tr>
</thead>
<tbody>
<tr><td><strong>Pod</strong></td><td>The smallest deployable unit &mdash; one or more containers that share a network namespace and storage, scheduled together.</td></tr>
<tr><td><strong>Node</strong></td><td>A machine (physical or virtual) that runs pods. The VMs of Unit 6 and Unit 7 are the nodes here.</td></tr>
<tr><td><strong>Control plane</strong></td><td>The components that watch the cluster and reconcile it with the declared specification: the API where state is declared, the scheduler that places pods, and the controllers that act on differences.</td></tr>
<tr><td><strong>Deployment (declared state)</strong></td><td>The specification of how many replicas of an image should be running. Change the number and the orchestrator creates or removes pods; change the image and it performs a <strong>rolling update</strong> that replaces pods gradually instead of stopping the service.</td></tr>
<tr><td><strong>Service</strong></td><td>A stable name and virtual address in front of a changing set of pods &mdash; which also provides <strong>load balancing</strong>, the infrastructure-layer function in 7.1.3.</td></tr>
<tr><td><strong>Self-healing</strong></td><td>The controller notices a pod that died or a node that failed and schedules replacements, so the declared replica count is restored without an operator.</td></tr>
<tr><td><strong>Managed Kubernetes</strong></td><td>The provider runs the control plane: <strong>GKE</strong> on Google Cloud, <strong>EKS</strong> on AWS, <strong>AKS</strong> on Azure (Unit 7.3.1). This is PaaS for orchestration.</td></tr>
</tbody>
</table>

<div class="concept-box tip">
<h4>Docker and Kubernetes in one sentence each</h4>
<p><strong>Docker packages an application and its dependencies into an image and runs it as an isolated container on a shared kernel; Kubernetes decides where those containers run, keeps the declared number of them alive, scales them with load, and gives them stable names.</strong> Docker answers "how does this run the same way everywhere?"; Kubernetes answers "how does it keep running, at the right size, when machines fail?" Because the course's syllabus pairs them in one sub-topic, an answer that gives only one of the two roles has answered half the question.</p>
</div>

<h3>9.3.3 The security caveat, from the deck</h3>
<p>Containers are not free isolation, and the course says so explicitly: the cons list includes <strong>less security due to sharing of the underlying operating system (the deck's example is Meltdown)</strong>, <strong>all containers must run atop the same kernel</strong>, and <strong>less flexibility with respect to hardware requirements</strong>. So the honest statement of the trade is this: virtualization puts a hypervisor between tenants and gives hardware-level isolation (Unit 6.1.10), while containers put a shared kernel between them and give speed and density instead &mdash; which is why the multi-tenant risks of Unit 8.4.1 are sharper for containers, and why "shared technology risks" is a named vulnerability rather than a hypothetical one.</p>

<p>The mechanism is worth being able to state, because it explains why the risk is structural and not a bug in any one product. A virtual machine's boundary is enforced by the hypervisor, so crossing it needs a flaw in the hypervisor itself. A container's boundary is enforced by the kernel the container shares with its neighbours, so crossing it needs <em>any</em> flaw in that kernel &mdash; which is exactly what Meltdown was, a processor-and-kernel-level flaw that let one process read memory belonging to another. Add one default that makes it worse: the first process in a container normally runs as <strong>root inside its own environment</strong>, so what a successful escape yields is not a foothold but root on the host, and with it every other container on that machine. Docker reduces that default with user namespaces, but it is a mitigation rather than a guarantee, and the last con on the deck's list follows from the same sharing: containers cannot supply a <em>different</em> kernel or set of drivers from the host's, so a workload needing another operating system or special hardware needs a virtual machine after all.</p>

<div class="concept-box tip">
<h4>What to write, and where it goes</h4>
<p>The deck gives the flaw; the standard hardening practices are worth naming as the response, because a security question usually wants both halves. Run the container as a non-root user, drop the capabilities it does not need, mount its filesystem read-only, apply a seccomp or AppArmor profile to restrict which system calls it may make, scan images for known-vulnerable packages and keep the host kernel patched &mdash; or put genuinely untrusted workloads in a sandboxed runtime or a virtual machine. In an answer about cloud-native architecture, one sentence carries it: <em>containers trade isolation for density, so on a shared host the container boundary must be hardened, and a shared-technology risk of this kind is mitigated rather than removed.</em></p>
</div>

<h2>9.4 Cloud-native and Microservices</h2>

<h3>9.4.1 What cloud-native means</h3>
<div class="concept-box key">
<p><strong>Cloud-native is a way of designing and running applications that takes the cloud's properties as given rather than treating the cloud as a place to host something built for a server.</strong> A cloud-native application assumes the platform is <strong>elastic, programmable, failure-prone and disposable</strong> &mdash; so it is built from <strong>small independently deployable services, packaged as containers, run on an orchestrator that can move and replace them, delivered continuously, and observed through logs, metrics and traces</strong>. The distinction that matters: <em>lift-and-shift</em> moves an existing application to the cloud unchanged and inherits the cloud's costs without its benefits; <em>cloud-native</em> changes the application's design so that elasticity, self-healing and pay-per-use are actually usable.</p>
</div>

<p>The defining characteristics, each of which is a property of this course rather than of a product:</p>
<table class="comparison-table">
<thead>
<tr><th>Characteristic</th><th>Why the cloud makes it possible</th></tr>
</thead>
<tbody>
<tr><td><strong>Microservices</strong></td><td>Small services with clear boundaries can be deployed and scaled independently &mdash; which only pays off when compute is elastic and cheap to start (Unit 5.2.1).</td></tr>
<tr><td><strong>Containers</strong></td><td>The image makes an application's environment <strong>reproducible and portable</strong> (Unit 6.2.2), which is what lets the same artefact run on a laptop, a test cluster and production.</td></tr>
<tr><td><strong>Orchestration</strong></td><td>Scheduling, self-healing and scaling are the platform's job rather than the operator's (9.3.2).</td></tr>
<tr><td><strong>Declarative configuration</strong></td><td>State is declared and reconciled rather than scripted, so the system can be rebuilt from its description &mdash; which is what makes automated recovery possible.</td></tr>
<tr><td><strong>Immutable infrastructure</strong></td><td>Instead of patching a running server, you replace it with a new image. This is the hypervisor's <strong>encapsulation</strong> benefit (Unit 6.1.10) taken to its conclusion, and it removes configuration drift &mdash; which is also the direct answer to Unit 8's <strong>misconfiguration</strong> vulnerability.</td></tr>
<tr><td><strong>Continuous delivery</strong></td><td>Small services and reproducible images allow many small deployments instead of rare large ones.</td></tr>
<tr><td><strong>Observability</strong></td><td>A system of many small services fails in many small ways, so logs, metrics and traces are how you find out why &mdash; the same requirement as Unit 8.4.2's centralised logging and SIEM.</td></tr>
<tr><td><strong>Horizontal scaling</strong></td><td>Load is handled by adding instances, not by enlarging one &mdash; the elasticity of 5.2.1 and the "add or remove computing instances" of 6.4.3.</td></tr>
</tbody>
</table>

<h3>9.4.2 Microservices, and the monolith they replace</h3>
<p>A <strong>microservice architecture structures an application as a set of small, independently deployable services, each owning its own data and communicating over a network interface</strong> &mdash; which in this course's vocabulary means <strong>each communicating only by passing messages</strong> (Unit 1.1), over the web service interfaces of Unit 2.4, with each service's remote interface defined as in Unit 2.2.</p>

<table class="comparison-table">
<thead>
<tr><th></th><th>Monolith</th><th>Microservices</th></tr>
</thead>
<tbody>
<tr><td><strong>Structure</strong></td><td>One deployable unit containing all the functionality.</td><td>Many small services, each independently deployable.</td></tr>
<tr><td><strong>Scaling</strong></td><td>Scale the whole application, even if one part is the bottleneck.</td><td>Scale only the service under load &mdash; elasticity applied where it is needed.</td></tr>
<tr><td><strong>Deployment</strong></td><td>One change means redeploying everything, so releases become rare and large.</td><td>Independent deployments, so releases become frequent and small.</td></tr>
<tr><td><strong>Technology</strong></td><td>One language, one framework, one runtime for the whole system.</td><td>Each service can use the best tool for its job (Unit 1.1's heterogeneity, used deliberately).</td></tr>
<tr><td><strong>Failure</strong></td><td>A fault in one module can take down the whole application.</td><td>A fault is contained in one service &mdash; but partial failure becomes the normal condition, not the exception.</td></tr>
<tr><td><strong>Data</strong></td><td>One database, transactions across all the data.</td><td>Each service owns its data, so consistency across services becomes the problem from Unit 4.1.6 &mdash; and is solved with events and eventual consistency rather than distributed transactions.</td></tr>
<tr><td><strong>Operations</strong></td><td>One thing to monitor and one log to read.</td><td>Many services to monitor &mdash; observability, tracing and service discovery become mandatory, which is exactly the complexity that containers and orchestration absorb.</td></tr>
<tr><td><strong>Best for</strong></td><td>A small team, a young product, or an application whose scale is modest.</td><td>A system with independent parts that need to scale and change at different rates, run by several teams.</td></tr>
</tbody>
</table>

<div class="concept-box warn">
<h4>The costs are distributed-systems costs, not fashion</h4>
<p>Splitting an application into services converts <strong>local calls into remote calls</strong>, and Unit 2 told us what that means: <strong>request latency</strong>, <strong>marshalling</strong>, <strong>call semantics</strong> and the five RPC faults &mdash; and the six ways a distributed object differs from a local one (Unit 2.0) apply to every internal call. A monolith's function call cannot lose its reply message; a microservice's call can. That is the reason a microservice architecture needs orchestration, retries, timeouts, tracing and idempotent operations, and it is the honest answer to "what are the disadvantages of microservices".</p>
</div>

<h3>9.4.3 How containers and orchestration support the architecture</h3>
<p>Fig 9.2 is best read as an <strong>argument in four steps</strong> rather than as a stack, and this section is that argument. <strong>Microservices create the need for packaging.</strong> Once the application is cut into many small services rather than built as one deployable unit, each service has to arrive at its destination with its own dependencies intact, because there is no longer one environment that everything shares. <strong>Packaging creates the need for orchestration.</strong> An image is a static artefact; something has to decide which machine runs it, how many copies exist, what happens when one dies and how traffic finds the survivors. That is a scheduling problem, not a packaging one, which is why Docker alone leaves a fleet of machines to look after. <strong>Many moving services create the need for delivery and observability.</strong> When releases are frequent and small, deployment has to be routine rather than an event; and when failures are partial, you cannot find them by looking at one machine &mdash; you need logs, metrics and traces that follow a request across services. None of these layers is decorative: remove one and the layer above stops being practical.</p>

<p>Each step has a cost, and naming it is what separates a description from a discussion. Microservices <strong>convert local calls into remote calls</strong>, so request latency, marshalling and partial failure arrive with them (9.4.2). Containers <strong>share the host kernel</strong>, so isolation is weaker than a hypervisor's and the shared-technology risk of Unit 8.4.1 is sharper (9.3.3). Orchestration <strong>adds an operational layer that is itself a distributed system</strong> &mdash; a scheduler, a control plane and a store of declared state, all of which can fail and all of which must be learned. The one-sentence version of the whole section: <em>the architecture is chosen for how it changes and scales, and the tools are what make that choice survivable at scale.</em></p>

<figure class="figure-wide figure-wrap">
<svg class="figure wide" viewBox="0 0 800 340" role="img" aria-label="A cloud-native stack: microservices on top, packaged as container images, scheduled and healed by an orchestrator across nodes, delivered by a pipeline, and observed through logs metrics and traces">
<defs><marker id="f9b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="flow-arrow-head"/></marker></defs>

<rect class="flow-box phase1" x="180" y="34" width="440" height="52" rx="10"/>
<text class="flow-text" x="400" y="58">Microservices</text>
<text class="flow-label" x="400" y="78" text-anchor="middle">small independently deployable services, each owning its data, talking over APIs</text>

<rect class="flow-box phase2" x="180" y="100" width="440" height="52" rx="10"/>
<text class="flow-text" x="400" y="124">Container images (Docker)</text>
<text class="flow-label" x="400" y="144" text-anchor="middle">each service packaged with its dependencies &mdash; the same artefact everywhere</text>

<rect class="flow-box phase3" x="180" y="166" width="440" height="52" rx="10"/>
<text class="flow-text" x="400" y="190">Orchestrator (Kubernetes)</text>
<text class="flow-label" x="400" y="210" text-anchor="middle">placement, declared replica counts, self-healing, scaling, stable names, rolling updates</text>

<rect class="flow-box phase4" x="180" y="232" width="440" height="46" rx="10"/>
<text class="flow-text" x="400" y="260">Nodes &mdash; virtual machines or bare metal</text>

<rect class="flow-box phase1" x="20" y="100" width="130" height="118" rx="10"/>
<text class="flow-label" x="85" y="130" text-anchor="middle">Delivery</text>
<text class="flow-label" x="85" y="152" text-anchor="middle">build &rarr; test &rarr;</text>
<text class="flow-label" x="85" y="172" text-anchor="middle">deploy, often,</text>
<text class="flow-label" x="85" y="192" text-anchor="middle">small changes</text>
<path class="flow-arrow" d="M154,160 H176" marker-end="url(#f9b)"/>

<rect class="flow-box phase3" x="650" y="100" width="130" height="118" rx="10"/>
<text class="flow-label" x="715" y="130" text-anchor="middle">Observability</text>
<text class="flow-label" x="715" y="152" text-anchor="middle">logs, metrics,</text>
<text class="flow-label" x="715" y="172" text-anchor="middle">traces &mdash;</text>
<text class="flow-label" x="715" y="192" text-anchor="middle">how many small</text>
<text class="flow-label" x="715" y="210" text-anchor="middle">failures are found</text>
<path class="flow-arrow" d="M624,160 H646" marker-end="url(#f9b)"/>

<text class="flow-label" x="400" y="306" text-anchor="middle">Each layer removes one operational burden, which is what makes many small services practical at all.</text>
<text class="flow-label" x="400" y="328" text-anchor="middle">Remove the orchestrator and the architecture becomes a fleet of machines to babysit.</text>
</svg>
<figcaption><strong>Fig 9.2 &mdash; The cloud-native stack.</strong> Read it as an argument rather than a stack diagram: microservices <em>need</em> reproducible packaging, packaging <em>needs</em> an orchestrator to be useful at scale, and a system of many moving services <em>needs</em> continuous delivery and observability to be operable. That chain is the answer to "how do containers and orchestration support cloud-native architecture".</figcaption>
</figure>

<h3>9.4.4 The trend list, in the syllabus's own terms</h3>
<table class="comparison-table">
<thead>
<tr><th>Trend</th><th>The one-line definition for an answer</th></tr>
</thead>
<tbody>
<tr><td><strong>Edge and fog computing</strong></td><td>Moving computation and storage toward the data source &mdash; fog nodes one hop from the devices, and in fog computing even end-user devices forming part of a provider-controlled system (Tanenbaum's formulation) &mdash; to cut latency and bandwidth and to keep data local.</td></tr>
<tr><td><strong>Serverless architecture</strong></td><td>Functions and managed backends that the customer does not provision or size, invoked by events and billed per invocation, with the platform scaling per request.</td></tr>
<tr><td><strong>Kubernetes and Docker</strong></td><td>Docker packages an application with its dependencies into an image and runs it as an isolated container on a shared kernel; Kubernetes schedules, heals and scales those containers across a cluster from a declared specification.</td></tr>
<tr><td><strong>Cloud-native and microservices</strong></td><td>Designing the application for the cloud's properties &mdash; small independently deployable services, containers, orchestration, declarative configuration, immutable infrastructure, continuous delivery and observability.</td></tr>
</tbody>
</table>

<p>Use the table as a checklist rather than as reading. A question on emerging trends is usually worth a few marks and asks for breadth, so the reliable structure is <strong>name the trend, define it in one line, and give one concrete example</strong> &mdash; and the four rows above are the syllabus's own four. Two habits keep the answer specific: state the <em>direction</em> each trend moves computation in (toward the data for edge and fog, away from provisioning for serverless, toward smaller deployable units for cloud-native), and name <em>what it answers</em> (latency and bandwidth for edge, idle capacity and operations for serverless, release speed and independent scaling for microservices).</p>

<p>One distinction is worth writing down because it is easy to blur: <strong>edge and fog computing move computation, while the other three move nothing</strong>. Serverless, containers and microservices are all changes to <em>how an application is built and run</em> inside a data centre; edge and fog change <em>where the data centre effectively is</em>. A question that asks you to compare them is really asking for that sentence.</p>

<h3>9.4.5 How this unit's trends connect to the rest of the course</h3>
<p>Two sentences, both of which are good closing paragraphs in an exam answer. First, the trends are <strong>one arc</strong>: consolidation into the cloud (Units 5&ndash;7), the problems that creates (Unit 8), and then distribution back out toward the data (edge and fog) while the application itself is decomposed so that it can be placed and scaled in pieces (microservices, containers, orchestration, serverless). Second, <strong>nothing in the course stops being true at the edge</strong>: clocks still drift, messages still get lost, replicas still disagree and failures are still partial &mdash; the constraints merely get tighter, which is why the same syllabus is what a cloud-native engineer uses every day.</p>

<p>Concretely, each trend is an earlier unit carried to a new place, and one line per trend is enough to show it. <strong>Edge and fog</strong> are Unit 5's deployment and service models asked a harder question: if latency and bandwidth are the cost, what if the cloud came to the data instead of the data to the cloud? <strong>Serverless</strong> is Unit 7.3's compute ladder completed &mdash; EC2 manages the OS for you, containers manage the runtime for you, and functions manage even the process lifetime, which is the provisioning question of Unit 6.4 with the provider doing the provisioning. <strong>Containers and Kubernetes</strong> are Unit 6.2's virtualisation discussion continued past the hypervisor, and their scheduling problem is Unit 6.4's resource management at cluster scale. <strong>Cloud-native and microservices</strong> are Unit 1's fundamental challenges used deliberately: heterogeneity becomes "each service, its own tool", concurrency and partial failure become the normal condition, and Unit 2's communication problems become every internal call. A question that asks how the unit relates to the course rewards exactly that mapping, so keep the four lines rather than the general claim.</p>

<p>The last thing worth carrying out of this unit is the honest limit on all four. Every one of them moves a problem rather than deleting it: edge computing moves computation but must still synchronise the results back (Unit 3), serverless moves provisioning but not the cold-start latency or the cost of a badly chosen partition, and microservices move complexity out of the code and into the operational platform. An answer that names what each trend buys <em>and</em> what it costs is the one that reads as understanding rather than as a list.</p>

<h3>9.4.6 The Group C answer, in its two halves</h3>
<p>The question is <em>&ldquo;Discuss cloud-native architecture. How do microservices, containers, and orchestration tools like Kubernetes support it? [4+4]&rdquo;</em> &mdash; so the first half defines the architecture and the second answers the "how" once per tool. The model answer is in the past-questions tab; the shape of it is this:</p>
<ol>
<li><strong>Half 1 (4 marks): what cloud-native architecture is.</strong> The definition in 9.4.1, then the characteristics in its table &mdash; microservices, containers, orchestration, declarative configuration, immutable infrastructure, continuous delivery, observability, horizontal scaling &mdash; and the contrast with lift-and-shift.</li>
<li><strong>Half 2 (4 marks): how each tool supports it.</strong>
<ul>
<li><strong>Microservices</strong> provide the <em>structure</em>: small independently deployable services, each owning its data, so parts can be scaled and changed without the whole.</li>
<li><strong>Containers</strong> provide the <em>packaging</em>: an image with code, dependencies and configuration makes each service's environment reproducible and portable, so the same artefact runs anywhere and configuration drift disappears.</li>
<li><strong>Orchestration</strong> provides the <em>operation</em>: Kubernetes schedules containers onto nodes, keeps the declared replica count alive, replaces what fails, adds and removes copies as load changes, gives services stable names, and performs rolling updates &mdash; which is what makes running many small services practical rather than a fleet of machines to babysit.</li>
</ul></li>
</ol>

<div class="concept-box tip">
<h4>The paper-facing part of this unit</h4>
<p>Everything in this unit that is written to be answered in the exam &mdash; what each question asks for, and the model answer to it &mdash; is collected in <a href="#/ch/9/past">Past Questions</a>. Read this tab for the subject; switch to that one when you sit down to answer a question.</p>
</div>
`,

  pastSummary: `<h2>Exam-facing summary</h2>
<table class="comparison-table">
<thead>
<tr><th>If the question says&hellip;</th><th>Give&hellip;</th></tr>
</thead>
<tbody>
<tr><td>Explain edge and fog computing</td><td>The motivation (latency, bandwidth, privacy, offline operation); the three tiers of Fig 9.1 with Tanenbaum's progression from edge-server content replication to distributed cloud systems to fog computing where even end-user devices are part of the system; the cloud-versus-fog-versus-edge table; what it buys; and the costs &mdash; many nodes, weaker physical security, fleet updates, and the return of Unit 3's clock and coordination problems.</td></tr>
<tr><td>What is serverless architecture?</td><td>The definition (the provider runs the code and the customer does not provision, size, patch or pay for servers), its two halves (FaaS and BaaS), and the five properties with their trades &mdash; event-driven, no server management, automatic fine-grained scaling with cold starts, pay per use, and stateless functions &mdash; plus where it is the wrong choice.</td></tr>
<tr><td>Explain Docker and Kubernetes</td><td>Docker: the container definition from Unit 6 (image bundling code, dependencies and configuration; isolated OS environments on a shared kernel; more efficient than VMs), and its vocabulary &mdash; image, container, Dockerfile, registry, engine. Kubernetes: why an orchestrator is needed (placement, self-healing, scaling, networking and discovery), what it is (declared state continuously reconciled), and its concepts &mdash; pod, node, control plane, deployment with rolling updates, service with load balancing, self-healing, and managed Kubernetes as GKE/EKS/AKS.</td></tr>
<tr><td>Discuss cloud-native architecture (4 marks)</td><td>The definition and the characteristics table: microservices, containers, orchestration, declarative configuration, immutable infrastructure, continuous delivery, observability and horizontal scaling &mdash; with the lift-and-shift contrast.</td></tr>
<tr><td>How do microservices, containers and Kubernetes support it? (4 marks)</td><td>Structure (microservices), packaging (containers) and operation (Kubernetes) &mdash; one paragraph each, with the cost of each: the distributed-systems costs for microservices, the shared-kernel security caveat for containers, and the operational layer Kubernetes puts between the developer and the machines.</td></tr>
<tr><td>Compare a monolith with microservices</td><td>The table in 9.4.2 &mdash; structure, scaling, deployment, technology, failure, data, operations and fit.</td></tr>
</tbody>
</table>


`,

  quiz: [
    {
      q: 'What is the main motivation for edge and fog computing?',
      options: [
        'Reducing the cost of data centre hardware',
        'Moving computation toward the data source to reduce latency and bandwidth, keep data local and allow offline operation',
        'Replacing cloud computing entirely',
        'Eliminating the need for replication'
      ],
      answer: 1,
      explanation: 'Sending all device data to a distant data centre costs latency (the round trip), bandwidth (the volume) and sometimes privacy or compliance (the data leaving a jurisdiction), and it fails when the device is offline. Units 5–8 were about consolidation; this is the counter-movement, with reasons that are physical.'
    },
    {
      q: 'In Tanenbaum\'s progression, what distinguishes fog computing from edge-server systems?',
      options: [
        'Fog nodes are in data centres',
        'In fog computing even end-user devices form part of the system and are (partly) controlled by a cloud service provider',
        'Fog computing uses no network',
        'Fog computing is another name for content delivery networks'
      ],
      answer: 1,
      explanation: 'The progression described: edge servers first replicated web pages; then, taking the data centre as the core, additional servers at the edge assist in computation and storage, leading to distributed cloud systems; and in fog computing even end-user devices form part of the system and are partly controlled by the provider.'
    },
    {
      q: 'Which tier has the highest latency to the data it processes?',
      options: [
        'The edge (the devices)',
        'The fog nodes',
        'The cloud data centre',
        'All three are equal'
      ],
      answer: 2,
      explanation: 'The tiers are distinguished by where the compute sits relative to the data source: edge compute is on the device (effectively no latency), fog is one local network hop away shared among many devices, and the cloud is tens to hundreds of milliseconds away depending on distance and routing.'
    },
    {
      q: 'Why is edge computing described as re-creating the problems this course has already solved once?',
      options: [
        'Because devices are more expensive than servers',
        'Because the devices have their own clocks, communicate only by messages, experience partial failure, and hold replicated data needing a consistency rule',
        'Because the software must be written in a different language',
        'Because edge nodes cannot be secured'
      ],
      answer: 1,
      explanation: 'Unit 3\'s clock synchronisation and coordination, Unit 1\'s message-only communication, Unit 4\'s fault tolerance and consistency all return — with less reliable hardware and intermittent connectivity. The constraints get tighter; the principles do not change.'
    },
    {
      q: 'In serverless computing, what does the customer pay for?',
      options: [
        'The servers, by the hour',
        'Invocations and execution duration, so nothing running means nothing billed',
        'A flat monthly subscription',
        'Only the storage used'
      ],
      answer: 1,
      explanation: 'FaaS bills per invocation and per unit of execution time. That billing model is why the architecture is event-driven and stateless, and why it is a poor fit for steady high load — an always-busy function costs more than a reserved virtual machine doing the same work.'
    },
    {
      q: 'What is a cold start in serverless computing?',
      options: [
        'Restarting the provider\'s data centre',
        'The delay before the first request after a period of idleness, while the runtime is initialised',
        'The time taken to deploy a new function version',
        'A function that runs in a cold region'
      ],
      answer: 1,
      explanation: 'Because functions are started on demand, an idle function\'s next invocation must wait for the runtime to initialise. It is the cost of not keeping a process warm, and it makes serverless unsuitable for latency-critical workloads.'
    },
    {
      q: 'What does BaaS mean in the serverless context?',
      options: [
        'Billing as a Service',
        'Backend as a Service — the managed services a function calls instead of running its own',
        'Bandwidth as a Service',
        'Backup as a Service'
      ],
      answer: 1,
      explanation: 'Serverless has two halves: FaaS (functions invoked by events) and BaaS (managed databases, queues, authentication, object storage and notifications). It is the same idea as DBaaS in Unit 7.2.3.'
    },
    {
      q: 'According to the Chapter 6 deck, how do containers differ from virtual machines architecturally?',
      options: [
        'Containers emulate hardware, VMs do not',
        'Containers create several isolated OS environments within the same host system kernel, so only binaries, libraries and runtime components are separate per container',
        'Containers include a full guest operating system each',
        'Containers require a hypervisor and VMs do not'
      ],
      answer: 1,
      explanation: 'A VM runs on a hypervisor which emulates hardware, so each instance carries its own guest OS; a container engine such as Docker creates isolated OS environments inside the same host kernel, which makes containers more resource-efficient. The trade is less isolation, since containers share the underlying OS.'
    },
    {
      q: 'What is the relationship between Docker and Kubernetes?',
      options: [
        'They are competing container engines',
        'Docker packages and runs containers on a machine; Kubernetes schedules, heals and scales them across a cluster',
        'Kubernetes builds container images and Docker orchestrates them',
        'Docker is the orchestrator and Kubernetes is the image registry'
      ],
      answer: 1,
      explanation: 'Docker answers "how does this run the same way everywhere?" by building an image and running it as a container; Kubernetes answers "how does it keep running, at the right size, when machines fail?" The syllabus pairs them in one sub-topic for that reason.'
    },
    {
      q: 'Which four problems does an orchestrator solve that a container engine alone does not?',
      options: [
        'Compilation, testing, packaging and publishing',
        'Placement, restarts and self-healing, scaling, and networking and discovery',
        'Encryption, authentication, authorisation and auditing',
        'Billing, metering, reporting and invoicing'
      ],
      answer: 1,
      explanation: 'At the scale of dozens or hundreds of containers across many machines: which node a container runs on, restarting it when it or its node fails, adding and removing copies with load, and giving callers a stable name because container addresses are not stable.'
    },
    {
      q: 'What is Kubernetes\'s central design idea?',
      options: [
        'You script every step of deployment in order',
        'You declare the desired state and the orchestrator continuously works to make the actual state match it',
        'Containers are pinned to specific machines forever',
        'Each container is given a fixed IP address'
      ],
      answer: 1,
      explanation: 'Declared state continuously reconciled — the same shape as the demand-driven provisioning of Unit 6.4.3, which compares a measured value against a threshold and corrects. In Kubernetes the compared quantity is the observed state of the cluster against a specification.'
    },
    {
      q: 'In Kubernetes, what is a pod?',
      options: [
        'A physical server in the cluster',
        'The smallest deployable unit — one or more containers sharing a network namespace and storage, scheduled together',
        'A container image stored in a registry',
        'A load-balancing rule'
      ],
      answer: 1,
      explanation: 'A node is the machine that runs pods (the VMs of Units 6 and 7); a service is a stable name and address in front of a changing set of pods, which also load-balances; and a deployment is the declaration of how many replicas of an image should be running.'
    },
    {
      q: 'Which of these is a stated disadvantage of containers?',
      options: [
        'They cannot be versioned',
        'Less secure due to sharing the underlying operating system, with Meltdown as the example',
        'They cannot run in cloud infrastructure',
        'They require more resources than virtual machines'
      ],
      answer: 1,
      explanation: 'The deck\'s three cons: all containers must run atop the same kernel, less security because the underlying OS is shared (Meltdown), and less flexibility with respect to hardware requirements. Virtualization gives hardware-level isolation; containers trade that for speed and density.'
    },
    {
      q: 'What is cloud-native architecture, as distinct from lift-and-shift?',
      options: [
        'An application that runs only in a public cloud',
        'An application designed for the cloud\'s properties — small independently deployable services in containers, orchestrated, declaratively configured, continuously delivered and observable',
        'An application rewritten in a cloud vendor\'s programming language',
        'An application that uses serverless functions exclusively'
      ],
      answer: 1,
      explanation: 'Lift-and-shift moves an existing application to the cloud unchanged and inherits the costs without the benefits; cloud-native changes the design so that elasticity, self-healing and pay-per-use are actually usable.'
    },
    {
      q: 'Which is a benefit of microservices over a monolith?',
      options: [
        'Fewer network calls',
        'Each service can be scaled and deployed independently, and a fault can be contained in one service',
        'A single database makes transactions easy',
        'Operations are simpler because there is only one log to read'
      ],
      answer: 1,
      explanation: 'Independent deployability and scaling, technology choice per service and fault containment are the benefits. The costs are that operations become harder (many services to monitor, hence observability) and data consistency across services becomes the problem from Unit 4.1.6.'
    },
    {
      q: 'Why does splitting an application into microservices introduce distributed-systems problems?',
      options: [
        'Because services must be written in different languages',
        'Because local calls become remote calls, so latency, marshalling, call semantics and the RPC failure modes all apply',
        'Because each service needs its own data centre',
        'Because containers cannot communicate'
      ],
      answer: 1,
      explanation: 'Every internal call becomes a call with request latency, marshalling, invocation semantics and the five RPC faults from Unit 2.1.3 — and the six differences between a local and a distributed object from Unit 2.0 apply at every boundary. A monolith\'s function call cannot lose its reply message; a microservice\'s call can.'
    },
    {
      q: 'Immutable infrastructure means:',
      options: [
        'Servers are never rebooted',
        'Instead of patching a running server you replace it with a new image',
        'Data cannot be deleted',
        'Containers are never rebuilt'
      ],
      answer: 1,
      explanation: 'Replacement rather than mutation removes configuration drift, and it is the hypervisor\'s encapsulation benefit taken to its conclusion. It is also the direct answer to Unit 8\'s misconfiguration vulnerability, since an image is built once and deployed identically.'
    },
    {
      q: 'Which of these is NOT one of the four sub-topics of this unit?',
      options: [
        'Edge and fog computing',
        'Serverless architecture',
        'Kubernetes and Docker',
        'Content delivery networks'
      ],
      answer: 3,
      explanation: 'The syllabus lists 9.1 Edge and Fog Computing, 9.2 Serverless Architecture, 9.3 Kubernetes and Docker and 9.4 Cloud-native and Microservices. CDNs are related to the edge — Tanenbaum\'s progression starts from edge servers replicating web pages — but they are not a named sub-topic.'
    }
  ],

  past: [
    {
      year: '2025 (expected)',
      marks: '5',
      repeats: 1,
      q: 'What is Kubernetes? Explain its role in container orchestration.',
      occ: [
        { year: '2025 (expected)', marks: '5', q: 'What is Kubernetes? Explain its role in container orchestration.' }
      ],
      answer: `
<h4>Model answer &mdash; 5 marks</h4>
<p><strong>Kubernetes</strong> is an open-source container orchestration system: it manages a
fleet of containers across a cluster of machines, and it is the <em>orchestration</em> half of
Docker's <em>containerisation</em> half. Docker builds and runs one container; Kubernetes
decides where the containers run, keeps them running, and connects them.</p>
<p><strong>What its role means in practice</strong>, and each of these is a problem that appears
only once you have more than a few containers:</p>
<ul>
<li><strong>Scheduling</strong> &mdash; placing each container on a node with enough capacity,
respecting its resource requests.</li>
<li><strong>Self-healing and desired state</strong> &mdash; you declare how many replicas should
run and Kubernetes restarts or reschedules them when one dies or a node fails.</li>
<li><strong>Scaling</strong> &mdash; replicas increase or decrease with load, which is what makes
microservices' independent scaling real.</li>
<li><strong>Service discovery and load balancing</strong> &mdash; containers are ephemeral and
their addresses change, so a stable name in front of a changing set is essential.</li>
<li><strong>Rolling updates and rollback</strong> &mdash; a new version replaces the old gradually
and can be reverted, which is what makes frequent deployment safe.</li>
<li><strong>Declarative configuration</strong> &mdash; the whole desired state is a file, so the
cluster can be reproduced and reviewed like code.</li>
</ul>
<div class="concept-box tip">
<h4>Marking this one</h4>
<p>Predicted &mdash; from the previous site's “Expected / 2025 Exam” set, 5 marks. The
definition is one mark; the rest are for the roles, so name them as roles rather than listing
features. Kubernetes appears in the syllabus beside Docker and microservices, so the answer is
better when it says what it lets a microservices architecture <em>do</em>.</p>
</div>
`
    },
    {
      year: '2025 (expected)',
      marks: '5',
      repeats: 1,
      q: 'Explain Edge Computing and Fog Computing. How do they differ from Cloud Computing?',
      occ: [
        { year: '2025 (expected)', marks: '5', q: 'Explain Edge Computing and Fog Computing. How do they differ from Cloud Computing?' }
      ],
      answer: `
<h4>Model answer &mdash; 5 marks</h4>
<p>Both move computation closer to where the data is produced. The reason is the same in both
cases: sending everything to a distant data centre costs latency and bandwidth, and some
workloads &mdash; a factory, a vehicle, a sensor grid &mdash; cannot wait for a round trip.</p>
<ul>
<li><strong>Edge computing</strong> &mdash; processing happens at or beside the source: on the
device, the gateway or the local server. The extreme end of the spectrum, minimal latency, and
the smallest amount of resource.</li>
<li><strong>Fog computing</strong> &mdash; an intermediate layer between the edge and the cloud:
local nodes with more capacity than a device but less than a data centre, handling aggregation,
filtering and short-term decisions, while the cloud keeps the heavy analysis and long-term
storage. Fog is best described as the middle tier that makes the edge and the cloud cooperate.</li>
</ul>
<table class="comparison-table">
<tr><th></th><th>Cloud</th><th>Fog</th><th>Edge</th></tr>
<tr><td>Distance to data</td><td>Far</td><td>Near</td><td>At the source</td></tr>
<tr><td>Latency</td><td>Tens to hundreds of ms</td><td>Low</td><td>Lowest</td></tr>
<tr><td>Capacity</td><td>Effectively unlimited</td><td>Moderate</td><td>Limited</td></tr>
<tr><td>Centralisation</td><td>Centralised</td><td>Partially distributed</td><td>Highly distributed</td></tr>
</table>
<p>The unit's framing: the cloud is the top tier, the edge is the bottom, and fog is the tier
that connects them. All three process the same data at different points in its journey.</p>
<div class="concept-box tip">
<h4>Marking this one</h4>
<p>Predicted &mdash; from the previous site's “Expected / 2025 Exam” set, 5 marks. Two
definitions and the contrast; the tier framing (cloud top, fog middle, edge bottom) is the
sentence that shows the three are one architecture rather than three unrelated ideas.</p>
</div>
`
    },
    {
      year: '2025 (expected)',
      marks: '6',
      repeats: 1,
      q: 'Compare Monolithic and Microservices architectures.',
      occ: [
        { year: '2025 (expected)', marks: '6', q: 'Compare Monolithic and Microservices architectures.' }
      ],
      answer: `
<h4>Model answer &mdash; 6 marks</h4>
<p>A monolith is one deployable unit containing every concern; microservices are that unit
split into independently deployable services communicating over the network. Every other
difference follows from that one.</p>
<table class="comparison-table">
<tr><th>Aspect</th><th>Monolithic</th><th>Microservices</th></tr>
<tr><td>Deployment</td><td>One artefact; a change redeploys everything</td><td>One artefact per service; deploy independently</td></tr>
<tr><td>Scaling</td><td>Scale the whole application</td><td>Scale only the service under load</td></tr>
<tr><td>Technology</td><td>One stack for everything</td><td>Each service picks its own stack</td></tr>
<tr><td>Data</td><td>One shared database &mdash; transactions are easy</td><td>Database per service &mdash; transactions need sagas or eventual consistency</td></tr>
<tr><td>Failure</td><td>One fault can take the whole application down</td><td>Failure is contained, but network failure is now a normal case</td></tr>
<tr><td>Operational cost</td><td>Low &mdash; one thing to run</td><td>High &mdash; many services, so orchestration and observability are required</td></tr>
<tr><td>Team fit</td><td>One team, one codebase</td><td>Small autonomous teams owning services</td></tr>
</table>
<p>The balanced sentence the marks want: microservices buy independent deployability and
fault isolation, and pay for them with distributed-systems complexity &mdash; which is why
containers and orchestration (Docker, Kubernetes) are named in the same syllabus sub-topic.
Neither is simply better; a small team on a young product is usually better served by a
monolith.</p>
<div class="concept-box tip">
<h4>Marking this one</h4>
<p>Predicted &mdash; from the previous site's “Expected / 2025 Exam” set, 6 marks. A
comparison, so an answer that describes both without contrasting them loses the marks that are
for the comparison. The trade-off sentence is what stops it reading as advocacy.</p>
</div>
`
    },
    {
      year: '2025 (expected)',
      marks: '4',
      repeats: 1,
      q: 'Explain Serverless Computing and its advantages.',
      occ: [
        { year: '2025 (expected)', marks: '4', q: 'Explain Serverless Computing and its advantages.' }
      ],
      answer: `
<h4>Model answer &mdash; 4 marks</h4>
<p><strong>Serverless</strong> (function-as-a-service, FaaS) is the deployment model in which the
provider runs the code and the customer supplies only a function. There is still a server; what
disappears is the customer's responsibility for it. The unit defines it as the point where the
provider manages the servers and the runtime, the application is broken into functions, and the
customer <strong>pays only for the time the code actually executes</strong> &mdash; and not for
idle time, which is the property that distinguishes it from a rented VM.</p>
<p><strong>The advantages.</strong></p>
<ul>
<li><strong>No server management</strong> &mdash; no operating system to patch, no capacity to
plan. This is the operational saving the model is sold on.</li>
<li><strong>Elastic to zero</strong> &mdash; it scales out automatically with load and costs
nothing when there is no load. A traditional deployment pays for an idle machine.</li>
<li><strong>Pay per invocation, in milliseconds</strong> &mdash; a cost model with no floor,
which suits spiky and intermittent workloads.</li>
<li><strong>Faster to build</strong> &mdash; the unit pairs it with microservices: one function
per concern, deployed independently, so a change ships without redeploying a monolith.</li>
</ul>
<p>The trade-off worth one line: a function is short-lived and stateless, so state must live in
a managed service, and a cold start is a latency the customer does not control.</p>
<div class="concept-box tip">
<h4>Marking this one</h4>
<p>Predicted &mdash; from the previous site's “Expected / 2025 Exam” set, 4 marks. Four
marks: the definition, then advantages. The definition is not complete without the billing
model, because pay-for-execution is what makes it serverless rather than merely managed.</p>
</div>
`
    },
    {
      year: 'Model 2025',
      marks: '8',
      repeats: 1,
      q: 'Discuss cloud-native architecture. How do microservices, containers, and orchestration tools like Kubernetes support it? [4+4]',
      occ: [
        { year: 'Model 2025', marks: '8', q: 'Discuss cloud-native architecture. How do microservices, containers, and orchestration tools like Kubernetes support it? [4+4]' }
      ],
      answer: `
<h4>Model answer &mdash; 8 marks</h4>

<p><strong>Part 1 &mdash; Cloud-native architecture (4 marks).</strong></p>
<p><strong>Definition.</strong> Cloud-native is <strong>a way of designing and running applications that treats the cloud's properties as given rather than treating the cloud as a place to host something built for a server</strong>. A cloud-native application assumes the platform is <strong>elastic, programmable, failure-prone and disposable</strong>, and is therefore built from <strong>small independently deployable services, packaged as containers, run on an orchestrator that can move and replace them, delivered continuously, and observed through logs, metrics and traces</strong>. The contrast that defines it is with <strong>lift-and-shift</strong>: moving an existing application to the cloud unchanged inherits the cloud's costs without its benefits, whereas cloud-native changes the design so that elasticity, self-healing and pay-per-use are actually usable.</p>

<p><strong>Characteristics.</strong></p>
<ul>
<li><strong>Microservices</strong> &mdash; small services with clear boundaries that can be deployed and scaled independently, which only pays off when compute is elastic and cheap to start.</li>
<li><strong>Containers</strong> &mdash; the image makes an application's environment <strong>reproducible and portable</strong>, so the same artefact runs on a laptop, a test cluster and in production.</li>
<li><strong>Orchestration</strong> &mdash; scheduling, self-healing and scaling become the platform's job rather than the operator's.</li>
<li><strong>Declarative configuration</strong> &mdash; state is declared and reconciled rather than scripted, which is what makes automated recovery possible.</li>
<li><strong>Immutable infrastructure</strong> &mdash; a server is replaced with a new image instead of being patched, which removes configuration drift (and is the answer to the misconfiguration vulnerability of Unit 8).</li>
<li><strong>Continuous delivery</strong> &mdash; many small deployments instead of rare large ones.</li>
<li><strong>Observability</strong> &mdash; logs, metrics and traces, because a system of many small services fails in many small ways.</li>
<li><strong>Horizontal scaling</strong> &mdash; load is handled by adding instances rather than enlarging one, which is elasticity applied in pieces.</li>
</ul>

<p><strong>Part 2 &mdash; How the three tools support it (4 marks).</strong></p>
<p><strong>Microservices provide the structure.</strong> The application is decomposed into <strong>small, independently deployable services, each owning its own data and communicating over a network interface</strong>. This is what makes independent scaling and independent deployment possible: only the service under load is scaled, and a change to one service does not require redeploying the rest. In this course's vocabulary, each service communicates <strong>only by passing messages</strong> (Unit 1), over <strong>web service interfaces</strong> (Unit 2.4), behind a <strong>remote interface</strong> (Unit 2.2) &mdash; and the cost is that every internal call becomes a remote call, with latency, marshalling, invocation semantics and the RPC failure modes attached. That cost is why the other two tools are necessary.</p>

<p><strong>Containers provide the packaging.</strong> Each service is packaged as an <strong>image containing the code, its dependencies and its configuration together</strong> &mdash; the container definition from the course material &mdash; and run as <strong>an isolated OS environment within the same host kernel</strong>, which makes containers more resource-efficient than virtual machines. Because the image carries its environment, deployment stops being a sequence of machine-specific installations and becomes the movement of one artefact: <strong>the environment is reproducible and portable</strong>, versioned like code, and identical everywhere. On the cloud that is what removes configuration drift and makes a service's behaviour predictable across development, test and production.</p>

<p><strong>Orchestration provides the operation.</strong> An orchestrator is needed because Docker alone does not decide <strong>placement</strong> (which container on which node), <strong>restarts and self-healing</strong> (what happens when a container or its node fails), <strong>scaling</strong> (adding and removing copies with load) or <strong>networking and discovery</strong> (a stable name when container addresses are not stable). <strong>Kubernetes solves all four, and its central idea is that you declare the desired state and the orchestrator continuously works to make the actual state match it</strong> &mdash; the same shape as the demand-driven provisioning of Unit 6.4, where a measured value is compared against a threshold and corrected. Concretely: <strong>pods</strong> are the smallest deployable units, <strong>nodes</strong> are the machines (the VMs of Units 6 and 7) that run them, the <strong>control plane</strong> schedules and reconciles, a <strong>deployment</strong> declares how many replicas of an image should run and supports <strong>rolling updates</strong> that replace pods gradually instead of stopping the service, a <strong>service</strong> gives a stable name and address in front of a changing set of pods and therefore <strong>load balancing</strong>, and <strong>self-healing</strong> restores the declared replica count when something fails. Providers sell this managed: <strong>GKE, EKS and AKS</strong>.</p>

<p><strong>Conclusion.</strong> The three fit together as a chain rather than a list: <strong>microservices need reproducible packaging, packaging needs an orchestrator to be useful at scale, and a system of many small services needs continuous delivery and observability to be operable</strong>. Remove the orchestrator and the architecture becomes a fleet of machines to babysit; remove the containers and every deployment becomes machine-specific; remove the microservices and there is nothing small enough to place and scale independently. And <em>serverless functions</em> (9.2) are the same progression one step further &mdash; the platform also decides when to run the code, and the customer deploys a function rather than a service.</p>

<div class="concept-box tip">
<h4>Where this came from</h4>
<p>Group C, question 15 of the <em>Model Question 2025</em>, marked <strong>[4+4]</strong> &mdash; two halves of 4 marks. Answer it in two headed parts. Note that the second half asks <em>how</em> the three tools support cloud-native architecture, so it wants one paragraph each describing a supporting role (structure, packaging, operation) rather than three separate descriptions; naming the cost of each &mdash; remote calls for microservices, the shared kernel for containers, the operational layer for Kubernetes &mdash; is what turns a description into a discussion. Fig 9.2 is that answer as a diagram.</p>
</div>`
    }
  ]
};

;
/* data/analysis.js */
/* Analysis data for the DCC portal.

   Unlike the Simulation portal's `data/analysis.js`, this is not generated from
   a question bank — there is no bank yet. It is hand-derived from the two
   documents the course itself supplies, and every number in it can be checked
   against them:

     syllabus_distbd_cloudcomptng.txt  page 3  the marks table (6,10,6,6,6,8,6,8,4 = 60)
     syllabus_distbd_cloudcomptng.txt  page 4  Model Question 2025, Group A and B
     syllabus_distbd_cloudcomptng.txt  page 5  Model Question 2025, Group C

   The per-unit question counts below are a real count of the sixteen questions
   in the model paper, sorted by which unit each one examines. app.js only draws
   the blocks it finds here, so the sections that need a real bank (most repeated
   topics, year-wise distribution) are absent rather than empty. */

window.ANALYSIS = {
  papers: ['Model 2025'],
  total_questions: 16,

  /* weight  = the unit's marks in the syllabus table
     questions = how many of the model paper's 16 questions examine this unit */
  chapters: {
    1: { title: 'Introduction to Distributed Systems',  weight: 6,  questions: 3 },
    2: { title: 'Communication in Distributed Systems', weight: 10, questions: 1 },
    3: { title: 'Synchronization and Coordination',     weight: 6,  questions: 3 },
    4: { title: 'Distributed File Systems',             weight: 6,  questions: 2 },
    5: { title: 'Introduction to Cloud Computing',      weight: 6,  questions: 3 },
    6: { title: 'Virtualization and Cloud Architecture', weight: 8, questions: 2 },
    7: { title: 'Cloud Platforms and Technologies',     weight: 6,  questions: 0 },
    8: { title: 'Security and Challenges in Cloud',     weight: 8,  questions: 1 },
    9: { title: 'Emerging Trends',                      weight: 4,  questions: 1 }
  },

  strategy: [
    {
      heading: 'The paper is 60 marks in three groups, and the arithmetic is worth knowing',
      items: [
        'Group A — four very short questions, 2 marks each, 8 marks total. The paper prints "2*4=8", so each is worth 2.',
        'Group B — eight short questions, answer any seven, 4 marks each. The paper does not print the per-question marks; they follow from the total: 8 + 7x + 3(8) = 60 gives x = 4.',
        'Group C — four long questions, answer any three, 8 marks each. Two of them print "[4+4]" explicitly, and 8 is the only value consistent with the total above.',
        'Group C alone is 24 of the 60 marks — 40% of the paper in three answers. Do not plan to run out of time before it.'
      ]
    },
    {
      heading: 'What the model paper actually asked, unit by unit',
      items: [
        'Unit 5 (Cloud Computing) and Unit 3 (Synchronization) each produced 3 of the 16 questions and Unit 1 produced 3 — between them 9 of 16.',
        'Unit 2 carries the single largest weight in the syllabus (10 marks) but produced only one question in the model paper, an RPC question in Group B. Expect more in the final.',
        'Unit 7 (AWS / Azure / GCP) carries 6 marks in the syllabus table and produced no question at all in the model paper. That is the gap to watch: either it is examined in the final, or those 6 marks move elsewhere.',
        'Unit 4 appeared twice, both in the long group — consistency in DFS (Group B) and HDFS architecture (Group C, [4+4]). HDFS is a repeating theme: it is also the example named in sub-topic 1.3.'
      ]
    },
    {
      heading: 'Choosing what to answer',
      items: [
        'Group B gives you a choice of 7 from 8, so you can drop one — but only if you know which one before you see the paper, which means covering every unit at least to note level.',
        'Group C gives 3 from 4. Because each is 8 marks, a weak Group C costs far more than a weak Group B: one missed Group B question is 4 marks, one missed Group C question is 8.',
        'The unit with the best marks-per-teaching-hour is Unit 1: 6 marks from 4 hours. The worst is Unit 3 looking at hours (6 marks from 5 hours) — but Unit 3 produced three model-paper questions, so it is worth more than its weight suggests.'
      ]
    },
    {
      heading: 'How these notes are sourced',
      items: [
        'Every unit\'s notes are written from that unit\'s own uploaded lecture material, read into text under _source/dcc/ by tools/dcc_extract.py.',
        'The slides are the primary source because they are what the class was taught from and the examiner teaches the course — the recommended books are for depth where a slide is a bare heading.',
        'Where a fact comes from a textbook rather than the slides, the note says which book and which chapter, so a claim can always be traced.'
      ]
    }
  ]
};

;
/* ../engine.js */
/* The app's pure logic — how a paper is assembled, how it is marked, how a quiz
   is scored, which entries a search term matches.

   No DOM, no localStorage, no state of its own: every function takes the data it
   needs and returns a value. app.js renders; this file decides. That split is
   what lets tools/test_engine.js pin these contracts in node, which matters
   because the marking bug (the breakdown bars divided by the syllabus weight
   while the score divided by the paper's total) was invisible to every check the
   project had and only ever found by eye.

   Loaded as a plain script before app.js; exposes `window.SM`. */
(function(){
'use strict';

/* This file is the pure logic for whichever course is on screen. `window.COURSE`
   is declared by the entry page before this script runs: index.html leaves it
   undefined (Simulation, the defaults below), and dcc-site/index.html defines
   its own. Every number that is really a fact about the syllabus therefore
   comes from there rather than being written into the logic.

   The defaults are the Simulation syllabus, so a page that does not set
   `window.COURSE` behaves exactly as it always did. */
const COURSE=(typeof window!=='undefined'&&window.COURSE)||{};

/* The syllabus weights, and the paper total as their sum — never a separate
   literal, so the header, the score and the breakdown cannot drift apart. */
const EXAM_WEIGHTS=COURSE.examWeights||[8,6,6,6,6,12,6,10];
const EXAM_TOTAL=EXAM_WEIGHTS.reduce((a,b)=>a+b,0);
const SEARCH_LIMIT=14;
/* The chapters this course has. Nine units are nine units; nothing else in here
   should have to know the number. */
const CHAPTER_COUNT=COURSE.chapterCount||8;

/* "2+8" -> 10. A card with no parseable marks is worth 2, which is the smallest
   mark a past question has ever carried. */
function marksOf(s){
  const m=String(s||'').match(/\d+/g);
  if(!m)return 2;
  const v=m.reduce((a,b)=>a+ +b,0);
  return v>0?v:2;
}
function stripTags(s){
  return String(s||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
}

/* Every subset of a chapter's answered questions that stays under cap, so the
   allocator can choose between several mark totals for each chapter. */
function chapterOptions(pool,cap){
  const dp=new Map();dp.set(0,[]);
  for(const it of pool){
    for(const [s,cb] of [...dp]){
      const ns=s+it.marks;
      if(ns<=cap&&!dp.has(ns))dp.set(ns,cb.concat([it]));
    }
  }
  return [...dp.entries()];
}

/* Assemble a paper that totals exactly `total` marks.

   Each chapter prefers its own syllabus weight, but a chapter whose pool cannot
   hit that weight exactly (Ch 2, 4, 5 and 7 have no combination adding to 6) may
   take a slightly larger or smaller set instead. A global dynamic program then
   picks one option per chapter so that the paper still comes to `total` with the
   smallest possible deviation from the published weights.

   `shuffle` is injected so the same paper can be rebuilt in a test. */
function buildPaper(chapters,opts){
  const o=opts||{},weights=o.weights||EXAM_WEIGHTS,total=o.total||EXAM_TOTAL;
  const mix=o.shuffle||(a=>a);
  const perCh={};
  for(let n=1;n<=weights.length;n++){
    const c=chapters[n];
    if(!c){perCh[n]=[[0,[]]];continue}
    const pool=mix((c.past||[]).filter(q=>q.answer)
      .map(q=>({ch:n,q,marks:marksOf(q.marks),repeats:q.repeats||1})));
    perCh[n]=chapterOptions(pool,weights[n-1]+5);
  }
  // State = total marks so far -> the lowest-deviation set of chapter picks
  // reaching that total. Comparing deviation (not just first-found) is what
  // lets the allocator keep every chapter close to its own weight.
  let states=new Map([[0,{dev:0,picks:[]}]]);
  for(let n=1;n<=weights.length;n++){
    const weight=weights[n-1],next=new Map();
    for(const [tot,st] of states){
      for(const [sum,combo] of perCh[n]){
        const nt=tot+sum;
        if(nt>total)continue;
        const dev=st.dev+Math.abs(sum-weight);
        const cur=next.get(nt);
        if(!cur||dev<cur.dev)next.set(nt,{dev,picks:st.picks.concat([{ch:n,sum,combo}])});
      }
    }
    if(next.size)states=next;
  }
  let best=null,bestScore=Infinity;
  for(const [tot,st] of states){
    const score=Math.abs(total-tot)*10+st.dev;
    if(score<bestScore){bestScore=score;best=st.picks}
  }
  const items=[];
  (best||[]).forEach(p=>p.combo.forEach(x=>items.push(x)));
  return items;
}

/* Mark a paper. `marked` maps an item index to true/false.

   `byChapter` reports, per chapter, the marks this paper actually set — that is
   the denominator a bar must use. Dividing by the syllabus weight instead makes
   a perfectly answered chapter read "5/6 marks" and the bars stop summing to the
   total in the header. */
function paperScore(items,marked){
  const mk=marked||{};
  const byChapter=[],seen={};
  let score=0,markedCount=0,total=0;
  items.forEach((it,idx)=>{
    total+=it.marks;
    if(mk[idx]){score+=it.marks;markedCount++}
    seen[it.ch]=(seen[it.ch]||0)+it.marks;
  });
  Object.keys(seen).map(Number).sort((a,b)=>a-b).forEach(ch=>{
    byChapter.push({ch,avail:seen[ch],got:items.reduce(
      (a,i,idx)=>a+(i.ch===ch&&mk[idx]?i.marks:0),0)});
  });
  return {score,total,markedCount,byChapter};
}

/* Score a quiz. `answers` maps a question index to the chosen option; an absent
   or null entry is unanswered and counts against nothing but still sits in the
   denominator, which is how the chapter badge has always read. */
function quizScore(quiz,answers){
  const a=answers||{},list=quiz||[];
  let answered=0,correct=0;
  list.forEach((q,i)=>{
    if(a[i]==null)return;
    answered++;
    if(a[i]===q.answer)correct++;
  });
  const total=list.length;
  return {total,answered,wrong:answered-correct,correct,
          pct:total?Math.round(correct/total*100):0};
}

/* The searchable corpus: every note section, quiz question and past question.
   `titles` is the per-chapter title, indexed by chapter number - 1. */
function buildIndex(chapters,titles){
  const idx=[];
  for(let n=1;n<=CHAPTER_COUNT;n++){
    const c=chapters[n];if(!c)continue;
    const title=(titles&&titles[n-1])||('Chapter '+n);
    String(c.learn||'').split(/(?=<h[23]>)/).forEach(p=>{
      const h=p.match(/<h[23]>([^<]*)<\/h[23]>/);
      const body=stripTags(p);if(body.length<40)return;
      idx.push({ch:n,type:'note',title:h?h[1]:title,snip:body.slice(0,170),key:(h?h[1]:title)});
    });
    (c.quiz||[]).forEach(q=>idx.push({ch:n,type:'quiz',title:q.q,
      snip:stripTags(q.explanation).slice(0,150),key:q.q.slice(0,45)}));
    // The chapter's exam-facing summary lives in `pastSummary` (moved out of
    // Learn by tools/move_exam_summary.py). Indexed as a past entry, so a search
    // hit routes to the Past tab - the panel this text is actually rendered in.
    String(c.pastSummary||'').split(/(?=<h[234]>)/).forEach(p=>{
      const h=p.match(/<h[234]>([^<]*)<\/h[234]>/);
      const body=stripTags(p);if(body.length<40)return;
      idx.push({ch:n,type:'past',title:h?h[1]:title,snip:body.slice(0,170),key:(h?h[1]:'Exam-facing summary')});
    });
    (c.past||[]).forEach(q=>idx.push({ch:n,type:'past',title:q.q,
      snip:(q.year||'')+' · '+(q.marks||'')+' marks'+(q.answer?' · model answer':' · practice question')
        +((q.occ||[]).length>1?' · also asked in '+(q.occ||[]).map(o=>o.year).join(', '):''),
      key:q.q.slice(0,45)}));
  }
  return idx;
}

/* Rank the index against a term. A hit in the title outranks a hit in the
   snippet; terms shorter than two characters match nothing, so a keystroke
   cannot open the panel with half the site in it. */
function search(index,term){
  const t=String(term||'').trim().toLowerCase();
  if(t.length<2)return[];
  const words=t.split(/\s+/),scored=[];
  (index||[]).forEach(e=>{
    const title=String(e.title||'').toLowerCase();
    const hay=title+' '+String(e.snip||'').toLowerCase();
    let s=0;
    words.forEach(w=>{if(hay.includes(w))s+=title.includes(w)?3:1});
    if(s>0)scored.push([s,e]);
  });
  scored.sort((a,b)=>b[0]-a[0]);
  return scored.slice(0,SEARCH_LIMIT).map(x=>x[1]);
}

/* The location, small enough to live in the URL hash. A view has to be
   addressable for the study flow to work: bookmark the question you keep
   getting wrong, send a friend the chapter you are both revising, come back on
   a phone and land on the same box you left.

     #/ch/4          chapter 4, Learn
     #/ch/4/quiz     chapter 4, Quiz
     #/analysis      the Analysis tab
     #/exam          the mock exam
     #/q/6-2         chapter 6, Past Questions, question #2 open

   parseRoute returns null for anything it does not recognise, so a mangled or
   hand-edited link falls back to the default view instead of throwing. The
   interesting decision is that an unknown tab is calmly treated as Learn while
   an unknown chapter is refused - a wrong tab still shows you a real page, a
   wrong chapter would show you nothing. */
const TABS=COURSE.tabs||['learn','quiz','past','analysis','exam'];
const CHAPTERS=CHAPTER_COUNT;
function parseRoute(hash){
  const raw=String(hash==null?'':hash).replace(/^#\/?/,'').trim();
  if(!raw)return null;
  let parts;
  try{parts=raw.split('/').filter(Boolean).map(decodeURIComponent)}
  catch(e){return null}
  const [head,arg,sub]=parts;
  if(head==='analysis')return {tab:'analysis',ch:null,q:null};
  /* A course without a mock exam (DCC has none yet) must not answer to
     `#/exam`; falling through to the default view is better than routing to a
     panel that does not exist. */
  if(head==='exam'&&TABS.indexOf('exam')>=0)return {tab:'exam',ch:null,q:null};
  if(head==='q'&&arg){
    const m=/^(\d+)-(\d+)$/.exec(arg);
    if(!m)return null;
    const ch=+m[1],q=+m[2];
    if(!(ch>=1&&ch<=CHAPTERS)||q<0)return null;
    return {tab:'past',ch,q};
  }
  if(head==='ch'&&arg){
    const ch=+arg;
    if(!(ch>=1&&ch<=CHAPTERS))return null;
    const tab=TABS.indexOf(sub)>=0?sub:'learn';
    return {tab,ch,q:null};
  }
  return null;
}
/* formatRoute is the inverse, so a route survives a round trip through the
   address bar - the property the contract test pins down. */
function formatRoute(route){
  const r=route||{};
  if(r.ch!=null&&r.q!=null&&r.q>=0)return '#/q/'+r.ch+'-'+r.q;
  if(r.tab==='analysis')return '#/analysis';
  if(r.tab==='exam'&&TABS.indexOf('exam')>=0)return '#/exam';
  const ch=r.ch||1;
  const tab=TABS.indexOf(r.tab)>=0?r.tab:'learn';
  return tab==='learn'?'#/ch/'+ch:'#/ch/'+ch+'/'+tab;
}

/* Exported: the constants the UI prints, and the behaviours the contract test
   and app.js actually call. stripTags and chapterOptions stay private - nothing
   outside this file reads them. */
window.SM={EXAM_WEIGHTS,EXAM_TOTAL,SEARCH_LIMIT,marksOf,TABS,
           buildPaper,paperScore,quizScore,buildIndex,search,
           parseRoute,formatRoute};
})();

;
/* ../modules/progress.js */
/* Owns the user's progress — the app's one piece of persisted state
   (localStorage '<course>-progress'), plus the XP/streak bookkeeping, the stats
   readout and export/import/reset.

   Everything else reads it through state() and changes it through
   state() + save(), so this file remains the only place that creates,
   persists or clears it. Registers `window.SMApp.Progress`. */
(function(){
'use strict';
const App=window.SMApp=window.SMApp||{};
/* The record is namespaced per course: the same origin can hold a Simulation
   record and a DCC one, and neither can overwrite the other. */
const NS=(window.COURSE&&window.COURSE.id)||'sm';
const KEY=NS+'-progress';
/* The XP bar is full when every chapter has been read, so both the target and
   the "n/m chapters" readout follow the course rather than the literal 8. */
const N=((window.COURSE&&window.COURSE.meta)||new Array(8)).length || 8;
let progress=JSON.parse(localStorage.getItem(KEY)||'{}');
if(!progress.xp)progress={xp:0,done:{},quizzes:0,totalQ:0,correctQ:0,streak:0,lastDay:''};

function state(){return progress}
function save(){localStorage.setItem(KEY,JSON.stringify(progress))}
function updateStreak(){
  const today=new Date().toDateString();
  if(progress.lastDay!==today){
    const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);
    if(progress.lastDay===yesterday.toDateString())progress.streak++;
    else if(progress.lastDay!==today)progress.streak=1;
    progress.lastDay=today;save();
  }
}
updateStreak();
function updateStats(){
  const doneCount=Object.keys(progress.done).length;
  const pct=progress.totalQ>0?Math.round(progress.correctQ/progress.totalQ*100):0;
  document.getElementById('xpVal').textContent=progress.xp+' XP';
  document.getElementById('xpFill').style.width=Math.min(progress.xp/(N*100)*100,100)+'%';
  document.getElementById('statChap').textContent=doneCount+'/'+N;
  document.getElementById('statQuiz').textContent=progress.quizzes;
  document.getElementById('statPct').textContent=pct+'%';
  document.getElementById('streakBadge').textContent=progress.streak;
  const xpBar=document.getElementById('xpBar');
  if(xpBar)xpBar.setAttribute('aria-valuenow',String(doneCount));
  document.querySelectorAll('.nav-item').forEach(el=>{
    const ci=el.dataset.ch;
    if(progress.done[ci])el.classList.add('done');else el.classList.remove('done');
    el.classList.toggle('progress',!progress.done[ci]&&!!(progress.seen||{})[ci]);
  });
  App.Shell.updateTabBadges();
}
function exportProgress(){
  const data={exported:new Date().toISOString(),progress,version:1};
  const blob=new Blob([JSON.stringify(data,null,1)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='simulation-progress-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(a);a.click();a.remove();
  App.Shell.toast(App.Shell.icon('download')+' Progress exported');
}
function importProgress(mode){
  const inp=document.createElement('input');inp.type='file';inp.accept='.json,application/json';
  inp.onchange=()=>{
    const f=inp.files&&inp.files[0];if(!f)return;
    const r=new FileReader();
    r.onload=()=>{
      try{
        const d=JSON.parse(r.result);const inc=d.progress||d;
        if(!inc||typeof inc!=='object')throw new Error('bad file');
        progress=(mode==='merge')?Object.assign({},progress,inc,{done:Object.assign({},progress.done,inc.done||{}),chapterQuiz:Object.assign({},progress.chapterQuiz,inc.chapterQuiz||{})}):inc;
        if(!progress.xp)progress={xp:0,done:{},quizzes:0,totalQ:0,correctQ:0,streak:0,lastDay:''};
        save();App.Shell.buildNav();updateStats();App.Shell.renderAnalysis();App.Shell.toast(App.Shell.icon('upload')+' Progress imported');
      }catch(err){App.Shell.toast(App.Shell.icon('alert')+' That file could not be read')}
    };
    r.readAsText(f);
  };
  inp.click();
}
function resetProgress(){
  if(!confirm('Reset all progress — XP, completed chapters, quiz scores and streak? This cannot be undone.'))return;
  localStorage.removeItem(KEY);localStorage.removeItem(NS+'-theme');location.reload();
}
App.Progress={state,save,updateStats,exportProgress,importProgress,resetProgress};
})();

;
/* ../modules/search.js */
/* Owns global search: the built index, the current hit list, the input wiring
   and jumping to a result. The matching itself lives in engine.js (SM.search);
   this module owns the panel and its keyboard. Registers `window.SMApp.Search`. */
(function(){
'use strict';
const App=window.SMApp=window.SMApp||{},SM=window.SM;
let IDX=[],SEARCH_HITS=[];
function build(){
  IDX=SM.buildIndex(App.Shell.chapters(),App.Shell.meta.map(m=>m.t));
}
function run(term){return SM.search(IDX,term)}
/* The panel is a real listbox: every hit is a `role="option"` with an id, the
   input is the combobox that owns it, and `aria-activedescendant` points at the
   arrow-key selection so a screen reader reads the option you are on. The count
   goes to a polite live region - a list of results appearing silently is the
   usual failure mode of an autocomplete. */
function wire(){
  const inp=document.getElementById('searchIn'),res=document.getElementById('searchRes'),live=document.getElementById('searchLive');
  let sel=-1;
  const optId=i=>'sr-opt-'+i;
  const announce=msg=>{if(live)live.textContent=msg};
  const close=()=>{
    res.classList.remove('show');sel=-1;
    inp.setAttribute('aria-expanded','false');
    inp.removeAttribute('aria-activedescendant');
  };
  const syncActive=()=>{
    if(sel<0){inp.removeAttribute('aria-activedescendant');return}
    inp.setAttribute('aria-activedescendant',optId(sel));
    // Keep the highlighted hit on screen: an arrow-key selection below the fold
    // would otherwise be invisible.
    const el=document.getElementById(optId(sel));
    if(el&&el.scrollIntoView)el.scrollIntoView({block:'nearest'});
  };
  const draw=()=>{
    if(!SEARCH_HITS.length){
      res.innerHTML='<div class="sr-empty" role="option" aria-disabled="true">No matches. Try "chi-square", "GPSS", "Markov", "auto-correlation".</div>';
      res.classList.add('show');
      inp.setAttribute('aria-expanded','true');
      inp.removeAttribute('aria-activedescendant');
      announce('No results for '+inp.value.trim());
      return;
    }
    res.innerHTML=SEARCH_HITS.map((e,i)=>'<div class="sr-item'+(i===sel?' sel':'')+'" id="'+optId(i)+'" role="option" aria-selected="'+(i===sel?'true':'false')+'" data-i="'+i+'"><span class="sr-tag">'+(e.type==='note'?'Notes':e.type==='quiz'?'Quiz':'Past Q')+'</span>'+App.Shell.esc(e.title)+'<div class="sr-meta">Ch '+e.ch+' · '+App.Shell.esc(e.snip)+'</div></div>').join('');
    res.classList.add('show');
    inp.setAttribute('aria-expanded','true');
    syncActive();
    announce(SEARCH_HITS.length+' result'+(SEARCH_HITS.length===1?'':'s')+' for '+inp.value.trim());
  };
  inp.addEventListener('input',()=>{SEARCH_HITS=run(inp.value);sel=-1;if(inp.value.trim().length<2){close();announce('');return}draw()});
  inp.addEventListener('keydown',ev=>{
    if(ev.key==='Escape'){close();inp.blur();return}
    if(ev.key==='ArrowDown'){ev.preventDefault();sel=Math.min(sel+1,SEARCH_HITS.length-1);draw();return}
    if(ev.key==='ArrowUp'){ev.preventDefault();sel=Math.max(sel-1,0);draw();return}
    if(ev.key==='Home'&&res.classList.contains('show')){ev.preventDefault();sel=0;draw();return}
    if(ev.key==='End'&&res.classList.contains('show')){ev.preventDefault();sel=SEARCH_HITS.length-1;draw();return}
    if(ev.key==='Enter'&&SEARCH_HITS.length){ev.preventDefault();gotoResult(sel<0?0:sel)}
  });
  res.addEventListener('click',ev=>{const it=ev.target.closest('.sr-item');if(it)gotoResult(+it.dataset.i)});
  document.addEventListener('click',ev=>{if(!ev.target.closest('.search-wrap'))close()});
  document.addEventListener('keydown',ev=>{
    // '/' is a plain shortcut: leave the browser's own chords (Cmd+/, Ctrl+/) alone.
    if(ev.key==='/'&&!ev.ctrlKey&&!ev.metaKey&&!ev.altKey&&document.activeElement!==inp&&!/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)){ev.preventDefault();inp.focus();inp.select()}
  });
}
function gotoResult(i){
  const e=SEARCH_HITS[i];if(!e)return;
  // One navigation through the shell's router, so a jump from search also
  // updates the address bar (and Back returns to the chapter, not the letter you
  // typed) instead of pushing two history entries.
  App.Shell.go({ch:e.ch,tab:e.type==='note'?'learn':e.type});
  const res=document.getElementById('searchRes'),inp=document.getElementById('searchIn');
  res.classList.remove('show');
  if(inp){inp.setAttribute('aria-expanded','false');inp.removeAttribute('aria-activedescendant')}
  setTimeout(()=>{
    const panel=document.getElementById(e.type==='note'?'panel-learn':(e.type==='quiz'?'panel-quiz':'panel-past'));
    const sel=e.type==='note'?'h2,h3':(e.type==='quiz'?'.quiz-card':'.pq-card');
    const key=e.key.replace(/\s+/g,' ').trim().slice(0,40).toLowerCase();
    const nodes=[...panel.querySelectorAll(sel)];
    const hit=nodes.find(n=>n.textContent.replace(/\s+/g,' ').trim().toLowerCase().includes(key));
    if(!hit)return;
    if(e.type==='past'&&hit.classList.contains('pq-card'))hit.classList.add('open');
    // A hit inside a folded section must reveal the section, or the jump would
    // land on something the reader cannot see.
    const sec=hit.closest('section.learn-sec');
    if(sec&&sec.classList.contains('collapsed'))App.Shell.setSection(sec,true,false);
    hit.scrollIntoView({behavior:'smooth',block:'center'});
    hit.classList.add('mark-flash');setTimeout(()=>hit.classList.remove('mark-flash'),2600);
  },80);
}
App.Search={build,run,wire,gotoResult};
})();

;
/* ../modules/quiz.js */
/* Owns the quiz: the live per-chapter run (`qs`) and its rendering and scoring.
   The score itself comes from engine.js (SM.quizScore); this module owns the
   badges, the completion result and the live state. Registers `window.SMApp.Quiz`. */
(function(){
'use strict';
const App=window.SMApp=window.SMApp||{},SM=window.SM;
let qs={};
function render(cn,questions){
  if(!questions.length){document.getElementById('panel-quiz').innerHTML='<p style="color:var(--t3)">No quiz available.</p>';return;}
  qs={total:questions.length,answered:0,correct:0,answers:{}};
  const ic=App.Shell.icon;
  const L='ABCDEF';
  let h=`<div class="quiz-header"><h3>Chapter ${cn} Quiz</h3><div class="quiz-progress"><div class="progress-bar" role="progressbar" aria-label="Questions answered" aria-valuemin="0" aria-valuemax="${questions.length}" aria-valuenow="0" id="qBar"><div class="progress-fill" id="qProg" style="width:0%"></div></div><span class="progress-text" id="qProgT">0/${questions.length}</span></div><div class="quiz-score"><span class="score-badge score-correct" id="sC">${ic('check')} 0</span><span class="score-badge score-wrong" id="sW">${ic('x')} 0</span></div></div>`;
  questions.forEach((q,i)=>{h+=`<div class="quiz-card" id="qc-${i}"><div class="q-number">Question ${i+1} of ${questions.length}</div><div class="q-text">${q.q}</div><div class="q-options">${q.options.map((o,j)=>`<div class="q-option" role="button" tabindex="0" aria-label="Option ${L[j]}: ${o}" onclick="APP.ans(${i},${j})"><span class="opt-letter">${L[j]}</span><span>${o}</span></div>`).join('')}</div><div class="q-explanation" id="qe-${i}"><strong>Why:</strong> ${q.explanation||''}</div></div>`;});
  h+=`<div class="quiz-result" id="quizResult"><div class="big-emoji"></div><div class="result-msg"></div><div class="result-sub"></div><div class="xp-earned"></div></div>`;
  h+=`<button class="quiz-reset" onclick="APP.load(${cn})">${ic('refresh')} Retake this quiz</button>`;
  document.getElementById('panel-quiz').innerHTML=h;
}
function answer(qi,oi){
  const ch=App.Shell.chapters()[App.Shell.cur()];if(!ch||!ch.quiz)return;
  const q=ch.quiz[qi],card=document.getElementById('qc-'+qi);
  if(card.classList.contains('answered-correct')||card.classList.contains('answered-wrong'))return;
  const opts=card.querySelectorAll('.q-option');
  opts.forEach(o=>o.classList.add('disabled'));
  const ok=oi===q.answer;
  opts[oi].classList.add(ok?'correct':'wrong');
  if(!ok)opts[q.answer].classList.add('correct');
  card.classList.add(ok?'answered-correct':'answered-wrong');
  document.getElementById('qe-'+qi).classList.add('show');
  qs.answers=qs.answers||{};qs.answers[qi]=oi;
  const tally=SM.quizScore(ch.quiz,qs.answers);
  qs.answered=tally.answered;qs.correct=tally.correct;qs.total=tally.total;
  const p=App.Progress.state();
  if(ok){p.xp+=2;p.correctQ++;}
  p.totalQ++;App.Progress.save();App.Progress.updateStats();
  document.getElementById('qProg').style.width=(qs.answered/qs.total*100)+'%';
  document.getElementById('qProgT').textContent=qs.answered+'/'+qs.total;
  const qBar=document.getElementById('qBar');
  if(qBar)qBar.setAttribute('aria-valuenow',String(qs.answered));
  const ic=App.Shell.icon;
  document.getElementById('sC').innerHTML=ic('check')+' '+qs.correct;
  document.getElementById('sW').innerHTML=ic('x')+' '+(qs.answered-qs.correct);
  if(ok)App.Shell.toast(ic('check')+' Correct · +2 XP');
  // Check quiz completion
  if(qs.answered===qs.total){
    p.quizzes++;App.Progress.save();App.Progress.updateStats();
    const pct=SM.quizScore(ch.quiz,qs.answers).pct;
    p.chapterQuiz=p.chapterQuiz||{};
    p.chapterQuiz[App.Shell.cur()]={correct:qs.correct,total:qs.total,pct:pct};App.Progress.save();
    const res=document.getElementById('quizResult');
    /* The verdict states what the score means and what to do about it. No
       medal, no star, no congratulations: the number is the feedback, and a
       reader who got 4 of 10 needs the next action more than applause. */
    let sub='';
    if(pct>=90)sub='Every answer on this chapter was right. Move on to the next one.';
    else if(pct>=70)sub='Solid. Re-read the sections behind the ones you missed, then retake this.';
    else if(pct>=50)sub='Half there — the explanations above name what to revise.';
    else sub='Read the chapter through once more before retaking this quiz.';
    res.querySelector('.result-msg').textContent=pct+'%';
    res.querySelector('.result-sub').textContent=sub;
    res.querySelector('.xp-earned').textContent='+'+qs.correct*2+' XP from this quiz';
    res.classList.add('show');
  }
}
App.Quiz={render,answer};
})();

;
/* ../modules/past.js */
/* Owns the past-question list: the active filter, the rendering of one card per
   question, and the one-click wordings/answer expanders. Registers
   `window.SMApp.Past`. */
(function(){
'use strict';
const App=window.SMApp=window.SMApp||{};
let pastFilter='all';
const normQ=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
/* Every wording this ONE question was asked with: the card's own text first,
   then each paper found by tools/extract_occurrences.py. Normalised text is the
   key, so a paper whose wording repeats the card's is not shown twice. */
function pastVariants(q){
  const out=[],seen=new Set();
  const add=(year,marks,text,primary,answer)=>{
    const k=normQ(text);
    if(!text||seen.has(k))return;
    seen.add(k);
    out.push({year:String(year||''),marks:String(marks==null?'':marks),text,primary:!!primary,answer:answer||null});
  };
  add(q.year,q.marks,q.q,true,q.answer);
  // variants first: a variant carries the model answer written for that paper,
  // an occurrence carries only the wording. Either way the wording is kept.
  (q.variants||[]).forEach(v=>add(v.year,v.marks,v.q,false,v.answer));
  (q.occ||[]).forEach(o=>add(o.year,o.marks,o.q,false,null));
  // Only offer "its own model answer" when it actually differs from the one on
  // the card - the same answer twice under two wordings reads like a bug.
  const flat=s=>String(s||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
  const seenAnswers=new Set([flat(q.answer)]);
  out.forEach(v=>{
    if(v.primary||!v.answer){v.answer=null;return}
    const k=flat(v.answer);
    if(!k||seenAnswers.has(k)){v.answer=null;return}
    seenAnswers.add(k);
  });
  return out;
}
/* `summary` is the chapter's exam-facing block - the "if the question says X,
   give Y" table, or the run of model answers - which used to sit at the end of
   the Learn text. It is paper-facing material, so it belongs on this tab, and
   tools/move_exam_summary.py is what moved it there. It renders below the cards
   and is NOT filtered: the pills select questions, and this is not a question. */
function render(questions,summary){
  const panel=document.getElementById('panel-past');
  if(!questions.length){panel.innerHTML='<p style="color:var(--t3)">No past questions available.</p>';return;}
  const rows=questions.map((q,i)=>({q,i}));
  const answered=rows.filter(r=>r.q.answer).length;
  const repeated=rows.filter(r=>(r.q.repeats||1)>=2).length;
  let list=rows;
  if(pastFilter==='answered')list=rows.filter(r=>r.q.answer);
  else if(pastFilter==='practice')list=rows.filter(r=>!r.q.answer);
  else if(pastFilter==='repeat')list=rows.filter(r=>(r.q.repeats||1)>=2);
  const practice=rows.length-answered;
  // The Practice pill only exists while there is something to practise: every
  // current card carries a model answer, so showing "Practice 0" would offer a
  // filter that can only ever come back empty.
  const ic=App.Shell.icon;
  let h='<div class="pq-filter">'+
    pill('all','All '+rows.length)+pill('answered',ic('check')+' Model answers '+answered)+(practice?pill('practice','Practice '+practice):'')+pill('repeat',ic('repeat')+' Repeated '+repeated)+'</div>';
  if(list.length){
    h+='<div class="pq-tools">'+
      '<button class="an-btn" onclick="APP.pastAll(true)">'+ic('chevron')+' Open every answer</button>'+
      '<button class="an-btn" onclick="APP.pastAll(false)">'+ic('chevronUp')+' Close every answer</button>'+
      '<button class="an-btn" onclick="APP.pastAllVariants()">'+ic('layers')+' Show every wording</button></div>';
  }
  h+='<h3>Exam questions <span class="pq-count">'+rows.length+' distinct questions · '+answered+' with a model answer · '+(rows.length-answered)+' practice</span></h3>';
  if(!list.length){
    panel.innerHTML=h+'<p style="color:var(--t3)">No questions in this filter.</p>'+summaryHtml(summary);
    return;
  }
  list.forEach(r=>{
    const q=r.q,i=r.i,rep=q.repeats||1;
    const variants=pastVariants(q);
    const others=variants.filter(v=>!v.primary);
    const papers=[...new Set(variants.map(v=>v.year).filter(Boolean))];
    const freq=rep>=4?'high':(rep>=2?'mid':'low');
    const body=q.answer?('<div class="pq-answer-inner">'+q.answer+'</div>')
      :'<div class="pq-pending"><strong>Practice question — model answer not written yet.</strong><br>Kept on the site so nothing is missing from the question list. Attempt it from the chapter notes: the same topic is worked in the answered questions above.</div>';
    const more=others.length?('<div class="pq-more">'+
        '<button class="pq-more-btn" aria-expanded="false" onclick="APP.tVariants('+i+',event)">'+ic('file')+' Same question in '+papers.length+' paper'+(papers.length>1?'s':'')+' — show each wording <span class="caret">'+ic('chevron')+'</span></button>'+
        '<div class="pq-variants" id="pv-'+i+'" hidden>'+variants.map((v,vi)=>
          '<div class="pq-variant'+(v.primary?' is-primary':'')+'">'+
          '<div class="pq-variant-meta">'+App.Shell.esc(v.year||'paper on record')+'<em>'+App.Shell.esc(v.marks?v.marks+' marks':'')+(v.primary?' · as written above':'')+'</em></div>'+
          '<p>“'+App.Shell.esc(v.text)+'”</p>'+
          (v.answer?'<button class="pq-var-btn" aria-expanded="false" onclick="APP.tVariantAnswer('+i+','+vi+',event)">its own model answer<span class="caret">'+ic('chevron')+'</span></button><div class="pq-var-answer" id="pva-'+i+'-'+vi+'" hidden></div>':'')+
          '</div>').join('')+
          (rep>papers.length?'<p class="pq-note">The question bank counts '+rep+' appearances in total; the remaining ones are paraphrases with no paper text on record.</p>':'')+
        '</div></div>'):'';
    h+='<div class="pq-card'+(q.answer?'':' practice')+'" id="pq-'+i+'"><div class="pq-question" role="button" tabindex="0" aria-expanded="false" aria-label="'+App.Shell.esc(q.year+' • '+q.marks+' marks: '+q.q).slice(0,140)+'" onclick="APP.tpq('+i+')">'+
      '<div class="pq-meta"><span class="pq-year">'+App.Shell.esc(q.year||'')+'</span><span class="pq-marks">'+App.Shell.esc(q.marks||'')+' marks</span>'+(rep>=2?'<span class="pq-repeat" data-freq="'+freq+'">asked '+rep+'×</span>':'')+'</div>'+pageChips(q)+
      '<div class="pq-text">'+App.Shell.esc(q.q)+((papers.length>1)?'<div class="pq-papers">'+papers.map(y=>'<span class="pq-paper">'+App.Shell.esc(y)+'</span>').join('')+'</div>':'')+'</div><div class="pq-toggle">'+ic('chevron')+'</div></div>'+
      '<div class="pq-answer">'+body+more+'</div></div>';
  });
  panel.innerHTML=h+summaryHtml(summary);
}
function summaryHtml(summary){
  if(!summary)return '';
  return '<section class="pq-summary">'+
    '<h3>How to answer them <span class="pq-count">the questions this unit has been asked with</span></h3>'+
    '<div class="pq-summary-body">'+summary+'</div></section>';
}
/* The pages of the class notes this answer's numbers were read off. The chip
   only names the page; app.js owns what a click does, so a citation is data. */
function pageChips(q){
  const ids=q.src||[];
  if(!ids.length)return '';
  return '<div class="pq-src">'+ids.map(id=>{
    const p=(window.NOTE_PAGES||{})[id];
    const label=p?p.p:id, title=p?(p.p+' — '+p.t):'Class notes';
    return '<button class="page-chip" type="button" data-page="'+App.Shell.esc(id)+'" title="'+App.Shell.esc(title)+'">'+App.Shell.esc(label)+'</button>';
  }).join('')+'</div>';
}
function pill(key,label){return '<button class="pq-pill'+(pastFilter===key?' on':'')+'" onclick="APP.pastFilter(\''+key+'\')">'+label+'</button>'}
function setFilter(f){pastFilter=f;const c=App.Shell.chapters()[App.Shell.cur()];if(c)render(c.past||[],c.pastSummary||'')}
function toggle(i){
  const c=document.getElementById('pq-'+i);if(!c)return;
  c.classList.toggle('open');
  const head=c.querySelector('.pq-question');
  if(head)head.setAttribute('aria-expanded',c.classList.contains('open')?'true':'false');
}
/* A variant that has a model answer of its own can show it, still inside the
   one card: the wording and the answer written for that paper. */
function toggleVariantAnswer(i,vi,ev){
  if(ev)ev.stopPropagation();
  const box=document.getElementById('pva-'+i+'-'+vi);
  if(!box)return;
  const btn=box.previousElementSibling;
  if(box.hasAttribute('hidden')){
    if(!box.dataset.filled){
      const v=pastVariants((App.Shell.chapters()[App.Shell.cur()].past||[])[i]||{})[vi];
      if(!v||!v.answer)return;
      box.innerHTML='<div class="pq-answer-inner">'+v.answer+'</div>';
      box.dataset.filled='1';
      App.Shell.enhanceContent(box);
    }
    box.removeAttribute('hidden');
    if(btn)btn.setAttribute('aria-expanded','true');
  }else{
    box.setAttribute('hidden','');
    if(btn)btn.setAttribute('aria-expanded','false');
  }
}
/* The one-click expander: reveal this question's other papers' wordings. */
function toggleVariants(i,ev){
  if(ev){ev.stopPropagation()}
  const box=document.getElementById('pv-'+i),btn=box&&box.previousElementSibling;
  if(!box)return;
  const open=box.hasAttribute('hidden');
  box.toggleAttribute('hidden',!open);
  if(btn)btn.setAttribute('aria-expanded',open?'true':'false');
}
function all(open){
  document.querySelectorAll('#panel-past .pq-card').forEach(c=>{
    c.classList.toggle('open',open);
    const head=c.querySelector('.pq-question');
    if(head)head.setAttribute('aria-expanded',open?'true':'false');
  });
}
/* Reveal one card by index, with its answer - what a `#/q/<ch>-<i>` link means.
   Returns false when the link names a card this chapter does not have, so the
   caller can skip the scroll instead of jumping to nowhere. */
function openOne(i){
  const card=document.getElementById('pq-'+i);
  if(!card)return false;
  card.classList.add('open');
  const head=card.querySelector('.pq-question');
  if(head)head.setAttribute('aria-expanded','true');
  return true;
}
function allVariants(){
  let any=false;
  document.querySelectorAll('#panel-past .pq-variants').forEach(v=>{if(v.hasAttribute('hidden'))any=true});
  document.querySelectorAll('#panel-past .pq-variants').forEach(v=>{
    v.toggleAttribute('hidden',!any);
    const b=v.previousElementSibling;if(b)b.setAttribute('aria-expanded',any?'true':'false');
  });
  document.querySelectorAll('#panel-past .pq-card').forEach(c=>{
    if(any)c.classList.add('open');
    const head=c.querySelector('.pq-question');
    if(head&&any)head.setAttribute('aria-expanded','true');
  });
}
App.Past={render,setFilter,toggle,toggleVariants,toggleVariantAnswer,all,allVariants,openOne};
})();

;
/* ../app.js */
/* The shell: it owns the shared data (the chapters, the chapter metadata, the
   chapter on screen), the design helpers, the navigation, the Analysis tab and
   the theme — and it wires the feature modules together.

   Each feature owns its own state in its own module:
     modules/progress.js   progress (localStorage 'sm-progress'), XP, streak,
                           the stats readout and export/import/reset
     modules/quiz.js       the live per-chapter quiz run
     modules/past.js       the past-question list and its filter
     modules/search.js     the search index and the current hit list
     modules/exam.js       the assembled mock paper, its timer and self-marking

   The modules read the chapter data and each other through `window.SMApp`;
   engine.js (window.SM) holds the pure decisions; this file registers
   `window.SMApp.Shell` for the handful of functions the modules call back into
   (render, navigate, toast, escape). It is loaded last, so the modules exist
   before it runs. */
(function(){
'use strict';
const App=window.SMApp=window.SMApp||{},SM=window.SM;
/* Which course this shell is running. `window.COURSE` is declared by the entry
   page before this file loads: index.html leaves it undefined, so the
   Simulation defaults below apply and nothing about that site changes;
   dcc-site/index.html defines its own course and gets the same shell with its
   own chapters, weights and storage namespace.

   `NS` is the localStorage namespace. Two courses on one origin must not share
   a progress record, and a reader who studies both should be able to keep both
   records - so every key is prefixed with the course id. */
const COURSE=window.COURSE||{};
const NS=COURSE.id||'sm';
const Progress=App.Progress,Quiz=App.Quiz,Past=App.Past,Search=App.Search,Exam=App.Exam;
const CH=window.CHAPTERS||{};
let cur=1;
/* Chapter metadata. No emoji: the chapter number is the identifier a reader
   actually navigates by, and eight different pictograms competed with it for
   attention without adding one bit of information. */
const meta=COURSE.meta||[
  {n:1,t:'Concept of Simulation',m:8,h:6},
  {n:2,t:'Monte Carlo Method',m:6,h:4},
  {n:3,t:'Continuous Systems',m:6,h:5},
  {n:4,t:'Queuing System',m:6,h:5},
  {n:5,t:'Verification & Validation',m:6,h:4},
  {n:6,t:'Random Number Generation',m:12,h:6},
  {n:7,t:'Simulation Output Analysis',m:6,h:5},
  {n:8,t:'Simulation Language',m:10,h:5}
];
/* How many chapters there are. It used to be the literal 8 in five places
   across this file and two in engine.js; a nine-chapter course (DCC) is a
   config change now rather than a hunt for the numbers. */
const N=meta.length;
/* ---------------- Icons ---------------- */
/* One drawn alphabet for the whole interface, replacing the emoji it used to
   be built out of. Every icon is a 24x24 outline built from primitives -
   circles, rects, straight lines, simple polylines - so they share one stroke
   weight, take currentColor from the text they sit in, scale with the font
   size, and render identically on every OS instead of being whatever that
   platform's emoji font happens to draw.
   Geometry over decoration: this is a study tool, not a sticker book. */
const ICONS={
  book:'<path d="M12 6.6S9.7 4.6 6.2 4.6H4v13.1h2.2c3.5 0 5.8 2 5.8 2s2.3-2 5.8-2H20V4.6h-2.2C14.3 4.6 12 6.6 12 6.6Z"/><path d="M12 6.6v13.1"/>',
  checklist:'<path d="M4 6.2 5.6 7.8 8.6 4.8"/><path d="M4 12.4 5.6 14 8.6 11"/><path d="M4 18.6 5.6 20 8.6 17"/><path d="M11.8 6.4H20"/><path d="M11.8 12.4H20"/><path d="M11.8 18.6H20"/>',
  file:'<path d="M13.6 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.4Z"/><path d="M13.6 3.5v4.9h4.9"/><path d="M9 13.2h6"/><path d="M9 16.6h4"/>',
  chart:'<path d="M4 20h16"/><path d="M7.2 20v-5.4"/><path d="M12 20V9.6"/><path d="M16.8 20V6"/>',
  clock:'<circle cx="12" cy="12" r="8.25"/><path d="M12 7.4V12l3.1 1.9"/>',
  target:'<circle cx="12" cy="12" r="8.25"/><circle cx="12" cy="12" r="3.4"/>',
  calendar:'<rect x="3.5" y="5.5" width="17" height="15" rx="2"/><path d="M3.5 10.2h17"/><path d="M8.2 3.4v4"/><path d="M15.8 3.4v4"/>',
  repeat:'<path d="M4 11.2V9.6a4 4 0 0 1 4-4h9"/><path d="M14.6 3 17.6 5.6 14.6 8.2"/><path d="M20 12.8v1.6a4 4 0 0 1-4 4H7"/><path d="M9.4 21 6.4 18.4 9.4 15.8"/>',
  alert:'<path d="M12 4.6 20.8 19.4H3.2Z"/><path d="M12 10v3.9"/><circle cx="12" cy="16.9" r=".9" fill="currentColor" stroke="none"/>',
  download:'<path d="M12 3.6v10.9"/><path d="M7.6 10.1 12 14.5l4.4-4.4"/><path d="M4.6 20.4h14.8"/>',
  upload:'<path d="M12 14.5V3.6"/><path d="M7.6 8 12 3.6 16.4 8"/><path d="M4.6 20.4h14.8"/>',
  trash:'<path d="M4.6 7h14.8"/><path d="M9.6 7V4.6h4.8V7"/><path d="M6.6 7l1 13.4h8.8l1-13.4"/><path d="M10.4 10.8v6"/><path d="M13.6 10.8v6"/>',
  eye:'<path d="M2.6 12S6.1 6.2 12 6.2 21.4 12 21.4 12 17.9 17.8 12 17.8 2.6 12 2.6 12Z"/><circle cx="12" cy="12" r="2.7"/>',
  play:'<path d="M8.2 5.6 18.4 12 8.2 18.4Z"/>',
  check:'<path d="M4.6 12.6 9.6 17.6 19.4 6.6"/>',
  x:'<path d="M6.2 6.2 17.8 17.8"/><path d="M17.8 6.2 6.2 17.8"/>',
  chevron:'<path d="M6.2 9.4 12 15.2l5.8-5.8"/>',
  chevronUp:'<path d="M6.2 14.6 12 8.8l5.8 5.8"/>',
  arrowUp:'<path d="M12 19.4V4.6"/><path d="M6.2 10.4 12 4.6l5.8 5.8"/>',
  arrowRight:'<path d="M4.6 12h14.8"/><path d="M13.6 6.2 19.4 12l-5.8 5.8"/>',
  arrowLeft:'<path d="M19.4 12H4.6"/><path d="M10.4 6.2 4.6 12l5.8 5.8"/>',
  refresh:'<path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 4.4V10h-5.6"/>',
  search:'<circle cx="10.75" cy="10.75" r="6.25"/><path d="M15.4 15.4 20 20"/>',
  menu:'<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2"/><path d="M12 19.2v2"/><path d="M2.8 12h2"/><path d="M19.2 12h2"/><path d="M5.5 5.5 6.9 6.9"/><path d="M17.1 17.1l1.4 1.4"/><path d="M18.5 5.5 17.1 6.9"/><path d="M6.9 17.1 5.5 18.5"/>',
  moon:'<path d="M20.2 14.6A8.6 8.6 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8Z"/>',
  sparkle:'<path d="M12 3.4l1.9 5.7 5.7 1.9-5.7 1.9L12 18.6l-1.9-5.7L4.4 11l5.7-1.9Z"/>',
  info:'<circle cx="12" cy="12" r="8.25"/><path d="M12 11.2v5.4"/><circle cx="12" cy="7.9" r=".95" fill="currentColor" stroke="none"/>',
  layers:'<path d="M12 3.6 3.6 8 12 12.4 20.4 8Z"/><path d="M3.6 12.6 12 17l8.4-4.4"/><path d="M3.6 16.8 12 21.2l8.4-4.4"/>',
  expand:'<path d="M4.6 9.4V4.6h4.8"/><path d="M14.6 4.6h4.8v4.8"/><path d="M19.4 14.6v4.8h-4.8"/><path d="M9.4 19.4H4.6v-4.8"/>',
  /* The width pair. A narrow column and a wide one, drawn as the same rounded
     rectangle at two widths: the control is about how much of the window the
     text takes, so the glyph is about how much of the square the rectangle
     takes. */
  column:'<rect x="8.7" y="4" width="6.6" height="16" rx="1.4"/>',
  wide:'<rect x="3.2" y="4" width="17.6" height="16" rx="1.4"/>'
};
function icon(name,cls){
  const d=ICONS[name];
  if(!d)return '';
  return '<svg class="i'+(cls?' '+cls:'')+'" viewBox="0 0 24 24" aria-hidden="true">'+d+'</svg>';
}
/* ---------------- Reading modes, and the two widths ----------------
   Paper is the default: the site is read far more often in daylight than in the
   dark, and the old default of a blue-black dashboard made every session start
   in the wrong room. Whatever the reader picks is remembered.

   Eight modes is why the top-bar control is a palette that opens a picker
   rather than the old sun/moon switch - with eight modes a two-state button has
   nothing to toggle. THEMES here is the source of truth for that picker, and it
   has to stay in step with two places that cannot read it:
     * assets/css/tokens.css, which declares one [data-theme="..."] block per id
       (a block that is missing means every token in it is UNDEFINED, not
       inherited from the base theme);
     * the boot script in each entry page, which has to set the mode before the
       first paint and so cannot wait for this file to load.
   tools/check_themes.py fails when the three lists drift apart.

   `strip` is the five swatches the mode was designed from - the picker shows
   them, so each tile reads like the palette it came from. `meta` is the browser
   chrome colour (a phone's address bar) and must match that mode's --bg. */
const THEMES=[
  {id:'light',      name:'Paper',              kind:'light', meta:'#fbfaf8', strip:['#fbfaf8','#f4f2ed','#eef3f9','#2c4a6e','#1b1a17']},
  {id:'dark',       name:'Lamp',               kind:'dark',  meta:'#191712', strip:['#191712','#232019','#37526f','#3f6e9e','#f4f1ea']},
  {id:'romantic',   name:'Romantic Blend',     kind:'light', meta:'#fcf2f5', strip:['#f5cdd0','#f4b3c7','#e69cba','#eb6e9b','#826e8b']},
  {id:'peacock',    name:'Peacock Feather',    kind:'light', meta:'#f4f9ee', strip:['#e1edd4','#cae5bc','#70d6c5','#4e9ce8','#4d52b4']},
  {id:'sunsetpeach',name:'Sunset View · Peach',kind:'light', meta:'#fdf6ea', strip:['#f5e4c4','#f5d6a2','#f5b297','#c78997','#8a99b1']},
  {id:'purpleblend',name:'Purple Blend',       kind:'dark',  meta:'#1a0a25', strip:['#2b103c','#3d2a5d','#572866','#8f529b','#ac91c0']},
  {id:'sunsetwine', name:'Sunset View · Wine', kind:'dark',  meta:'#230a11', strip:['#812d35','#934372','#b9689f','#c388a9','#536ca5']},
  {id:'eveningmix', name:'Evening Mix',        kind:'dark',  meta:'#0e0d15', strip:['#0e0d15','#182346','#3d5387','#7c83ad','#bfa9ba']},
  /* The ninth is derived, not declared - see custom-theme.js. What is fixed here
     is only what a reader who has never opened the picker sees, and it has to
     match [data-theme="custom"] in tokens.css, which tools/check_themes.py and
     tools/test_custom_theme.js both enforce. `kind`, `meta` and `strip` are
     replaced live by mode() below the moment there are two colours to derive
     from; these are the seed values. */
  {id:'custom',     name:'Yours',              kind:'light', meta:'#f6f5f2', strip:['#f6f5f2','#edebe4','#dedfee','#4f5bd5','#2b281e'], custom:true}
];
/* The other axis. Comfort is the phone and the small laptop; Full is a laptop
   run at full screen, where the centred column's margins were the complaint. */
const WIDTHS=[
  {id:'comfort', name:'Comfort', ico:'column', hint:'narrow centred column, short lines'},
  {id:'full',    name:'Full',    ico:'wide',   hint:'wide column, uses the whole screen'}
];
const html=document.documentElement,tBtn=document.getElementById('themeBtn'),wBtn=document.getElementById('widthBtn');
/* Derived palettes are memoised on the two colours they came from: derive()
   solves ~40 colours by walking, and mode() is called on every paint of the
   button and every open of the picker. */
let customMemo={key:'',val:null};
function customNow(){
  const s=CustomTheme.stored(),key=s.accent+'|'+s.surface;
  if(key!==customMemo.key){
    const pal=CustomTheme.derive(s.accent,s.surface);
    customMemo={key,val:{accent:s.accent,surface:s.surface,palette:pal,
                         record:CustomTheme.pack(pal,s.accent,s.surface)}};
  }
  return customMemo.val;
}
/* `mode(id)` is the single place that answers "what does this mode look like".
   Custom is the one id whose answer is not in the table above, so it is answered
   from the derivation instead - which means the top-bar swatches, the picker's
   Light/Dark label, the browser chrome and the applied palette all move together
   when the reader drags a colour, with nothing else to keep in step. */
const mode=id=>{
  const base=THEMES.find(t=>t.id===id)||THEMES[0];
  if(!base.custom)return base;
  const p=customNow().palette;
  return {id:'custom',name:base.name,kind:p.kind,meta:p.meta,strip:p.strip,custom:true};
};
const widthOf=id=>WIDTHS.find(w=>w.id===id)||WIDTHS[0];
function swatchRow(strip,cls){
  return '<span class="'+(cls||'tp-strip')+'" aria-hidden="true">'+
    strip.map(c=>'<i style="background:'+c+'"></i>').join('')+'</span>';
}
/* The button's own glyph is a strip of the current mode's five colours, so the
   swatch in the top bar already says which room you are in. */
function paintThemeBtn(){
  const t=mode(html.getAttribute('data-theme'));
  tBtn.innerHTML=swatchRow(t.strip,'btn-strip');
  const label='Reading mode: '+t.name+' ('+t.kind+')';
  tBtn.title=label+' - choose another';
  tBtn.setAttribute('aria-label',label+', choose another');
}
function setTheme(id,save){
  const t=mode(id);
  // Custom is the one mode whose colours live INLINE on <html>, because they
  // cannot be written into a stylesheet. Inline beats every selector, so leaving
  // them there while another mode is selected would leave every other palette
  // painted in the reader's own colours - hence the else branch, which is not
  // tidiness but the difference between the switch working and not.
  if(t.custom){
    const now=customNow();
    CustomTheme.apply(now.palette,html);
    CustomTheme.remember(now.accent,now.surface,now.palette);
  }else{
    CustomTheme.clear(html);
  }
  html.setAttribute('data-theme',t.id);
  // The browser's own chrome - the mobile address bar, the PWA title bar -
  // follows the mode the reader chose, not the one the OS guessed.
  const meta=document.getElementById('themeColor');
  if(meta)meta.setAttribute('content',t.meta);
  paintThemeBtn();
  syncPicker();
  if(save!==false)localStorage.setItem(NS+'-theme',t.id);
}
/* A colour input fires `input` continuously while the picker is open. Each one
   re-derives the whole palette, applies it, and rewrites the cached copy the
   boot script reads - which is the reason a reload does not flash the seed. */
function tuneCustom(which,value){
  const s=CustomTheme.stored();
  const accent=which==='accent'?value:s.accent, surface=which==='surface'?value:s.surface;
  // Colours first, then drop the memo: customNow() derives FROM storage, so
  // writing the new value after invalidating would re-derive the old palette
  // and cache it under the new key.
  CustomTheme.remember(accent,surface);
  customMemo={key:'',val:null};
  const now=customNow();
  CustomTheme.remember(now.accent,now.surface,now.palette);
  CustomTheme.apply(now.palette,html);
  html.setAttribute('data-theme','custom');
  const meta=document.getElementById('themeColor');
  if(meta)meta.setAttribute('content',now.palette.meta);
  paintThemeBtn();
  syncPicker();
  if(pop)localStorage.setItem(NS+'-theme','custom');
}
/* The two colour wells, and the live swatches on the Custom tile. They are a
   separate block from the radio grid rather than inside the Custom button,
   because an <input> inside a <button> is invalid markup and the click would be
   swallowed by the button underneath it. */
function paintTune(){
  const row=pop&&pop.querySelector('#tpTune');
  if(!row)return;
  const on=html.getAttribute('data-theme')==='custom';
  row.hidden=!on;
  if(!on)return;
  const s=CustomTheme.stored();
  const a=row.querySelector('#tpAccent'),f=row.querySelector('#tpSurface');
  if(a&&a.value.toLowerCase()!==s.accent)a.value=s.accent;
  if(f&&f.value.toLowerCase()!==s.surface)f.value=s.surface;
}
function paintCustomTile(){
  const tile=pop&&pop.querySelector('.tp-item[data-mode="custom"]');
  if(!tile)return;
  const t=mode('custom');
  const strip=tile.querySelector('.tp-strip');
  if(strip)strip.innerHTML=t.strip.map(c=>'<i style="background:'+c+'"></i>').join('');
  const kind=tile.querySelector('.tp-txt span');
  if(kind)kind.textContent=t.kind==='dark'?'Dark':'Light';
}
function paintWidthBtn(){
  const w=widthOf(html.getAttribute('data-width')),other=w.id==='full'?'Comfort':'Full';
  wBtn.innerHTML=icon(w.ico);
  wBtn.setAttribute('aria-pressed',w.id==='full'?'true':'false');
  const label='Layout: '+w.name+' - '+w.hint+'. Switch to '+other+'.';
  wBtn.title=label;wBtn.setAttribute('aria-label',label);
}
function setWidth(id,save){
  const w=widthOf(id);
  html.setAttribute('data-width',w.id);
  paintWidthBtn();
  if(save!==false)localStorage.setItem(NS+'-width',w.id);
}
/* The picker.

   A radiogroup rather than a menu: the modes are one choice out of eight, and
   that is exactly what a screen reader should announce. Choosing a mode does NOT
   close the panel - the point of eight palettes is comparing them, so the page
   behind repaints and the panel stays until you pick something else, press Esc,
   or click away. */
let pop=null;
function tiles(){return pop?Array.prototype.slice.call(pop.querySelectorAll('.tp-item')):[];}
function buildPicker(){
  const el=document.createElement('div');
  el.className='theme-pop';
  el.id='themePop';
  el.setAttribute('role','dialog');
  el.setAttribute('aria-label','Reading mode');
  el.hidden=true;
  el.innerHTML=
    '<p class="tp-head"><b>Reading mode</b><span>'+THEMES.length+' modes · remembered on this device</span>'+
      // Sync is here rather than in the top bar because it is about the MODE, and
      // the mode is what this panel is for. It copies a link; see applyLink().
      '<button type="button" class="tp-sync" id="tpSync" title="Copy a link that opens this mode and this width on another device">Sync</button></p>'+
    '<div class="tp-grid" role="radiogroup" aria-label="Reading mode">'+
      THEMES.map(id=>{
        // through mode(), not the table: the Custom tile shows the reader's own
        // five colours and its current kind, both of which move as they drag.
        const t=mode(id.id);
        return '<button type="button" class="tp-item" role="radio" aria-checked="false" data-mode="'+t.id+'" tabindex="-1">'+
          swatchRow(t.strip)+
          '<span class="tp-txt"><b>'+t.name+'</b><span>'+(t.kind==='dark'?'Dark':'Light')+'</span></span>'+
          '<svg class="i tp-tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.6 9.6 17 19 7"/></svg>'+
        '</button>';
      }).join('')+
    '</div>'+
    // Only shown while Custom is the chosen mode: two colour wells sitting under
    // eight finished palettes would read as a ninth palette you are meant to
    // colour in first, which is the wrong way round.
    '<div class="tp-tune" id="tpTune" hidden>'+
      '<p class="tp-sub">Your two colours - the rest is derived from them.</p>'+
      '<div class="tp-wells">'+
        '<label for="tpAccent">Accent<input type="color" id="tpAccent" aria-label="Accent colour"></label>'+
        '<label for="tpSurface">Page<input type="color" id="tpSurface" aria-label="Page colour"></label>'+
      '</div>'+
    '</div>';
  el.addEventListener('click',e=>{
    const b=e.target.closest('.tp-item');
    if(b){setTheme(b.dataset.mode);return;}
    if(e.target.closest('#tpSync'))shareAppearance();
  });
  // `input` and not `change`: dragging inside a colour well should repaint the
  // page behind the panel, which is the whole reason to have nine modes.
  el.addEventListener('input',e=>{
    if(e.target.id==='tpAccent')tuneCustom('accent',e.target.value);
    else if(e.target.id==='tpSurface')tuneCustom('surface',e.target.value);
  });
  el.addEventListener('keydown',e=>{
    // The colour wells are in this panel but not in the radio group: arrows
    // inside a colour input move its channel, and hijacking that would make the
    // well unusable.
    if(e.target.tagName==='INPUT'){
      if(e.key==='Escape'){e.preventDefault();closePicker();}
      return;
    }
    const list=tiles(),i=list.indexOf(document.activeElement);
    if(e.key==='Escape'){e.preventDefault();closePicker();return;}
    let n=null;
    if(e.key==='ArrowDown'||e.key==='ArrowRight')n=i+1;
    else if(e.key==='ArrowUp'||e.key==='ArrowLeft')n=i-1;
    else if(e.key==='Home')n=0;
    else if(e.key==='End')n=list.length-1;
    if(n===null)return;
    e.preventDefault();
    n=(n+list.length)%list.length;
    list.forEach(b=>b.tabIndex=-1);
    list[n].tabIndex=0;
    list[n].focus();
  });
  return el;
}
function syncPicker(){
  if(!pop)return;
  const cur=html.getAttribute('data-theme');
  tiles().forEach(b=>{
    const on=b.dataset.mode===cur;
    b.setAttribute('aria-checked',on?'true':'false');
    b.tabIndex=on?0:-1;
  });
  paintCustomTile();
  paintTune();
}
function openPicker(){
  if(!pop){
    pop=buildPicker();
    document.querySelector('.topbar-r').appendChild(pop);
  }
  syncPicker();
  pop.hidden=false;
  tBtn.setAttribute('aria-expanded','true');
  const cur=pop.querySelector('.tp-item[aria-checked="true"]')||tiles()[0];
  if(cur)cur.focus();
}
function closePicker(refocus){
  if(!pop||pop.hidden)return;
  pop.hidden=true;
  tBtn.setAttribute('aria-expanded','false');
  if(refocus!==false)tBtn.focus();
}
tBtn.setAttribute('aria-haspopup','true');
tBtn.setAttribute('aria-expanded','false');
tBtn.onclick=()=>{(pop&&!pop.hidden)?closePicker():openPicker();};
wBtn.onclick=()=>setWidth(html.getAttribute('data-width')==='full'?'comfort':'full');
document.addEventListener('pointerdown',e=>{
  if(!pop||pop.hidden)return;
  if(pop.contains(e.target)||tBtn.contains(e.target))return;
  closePicker(false);
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closePicker(false);});
/* ---------------- the link: how a choice reaches another device ----------------

   A reader who has picked their mode on a laptop should not have to pick it
   again on a phone, and the honest way to do that without an account or a
   backend is a URL - the format lives in custom-theme.js, with the reasoning.

   THE TWO HALVES MATTER EQUALLY. Sync() writes the reader's appearance into a
   link, and applyLink() is what makes opening that link on the other device
   change anything: without it the parameters would be decoration. */
function appearanceURL(){
  const s=CustomTheme.stored();
  return location.origin+location.pathname+location.hash+
    CustomTheme.link({theme:html.getAttribute('data-theme'),
                      width:html.getAttribute('data-width'),
                      accent:s.accent,surface:s.surface});
}
function shareAppearance(){
  const url=appearanceURL();
  const done=()=>toast('Link copied - open it on your other device');
  const ask=()=>window.prompt('Copy this link and open it on your other device',url);
  // Over https (GitHub Pages, Netlify) the clipboard API is available. Over
  // plain http it is not, which is exactly how this gets tested locally - hence
  // the prompt, which is not a fallback anyone should be embarrassed about: it
  // shows a selectable URL and works everywhere, including a denied permission.
  if(navigator.clipboard&&navigator.clipboard.writeText)
    navigator.clipboard.writeText(url).then(done,ask);
  else ask();
}
/* Opening a link that carries an appearance applies it AND stores it, so the
   next visit on this device needs no link. The parameters are then taken back
   off the URL: left in place, a reload would re-assert a mode the reader may
   have changed since - the link is a courier, not a setting. Only the SEARCH is
   rewritten; the site routes on the hash, and dropping that would lose the
   reader's place in the chapter. */
function applyLink(){
  let L;
  try{ L=CustomTheme.readLink(location.search); }catch(e){ return; }
  if(!L.theme&&!L.width)return;
  if(L.accent&&L.surface)CustomTheme.remember(L.accent,L.surface);
  if(L.theme&&THEMES.some(t=>t.id===L.theme))localStorage.setItem(NS+'-theme',L.theme);
  if(L.width)localStorage.setItem(NS+'-width',L.width);
  if(history.replaceState)history.replaceState(null,'',location.pathname+location.hash);
}
applyLink();
/* `false` = do not write these back: the boot script in the entry page already
   read the stored values and set both attributes before the first paint, so
   this call only paints the two buttons to match. */
setTheme(localStorage.getItem(NS+'-theme')||'light',false);
setWidth(localStorage.getItem(NS+'-width')||'comfort',false);
/* Toast */
/* A toast is the only feedback some actions give ("+10 XP", "Saved"), so it is
   a polite status region rather than a silent div. It enters and leaves with a
   transition rather than a keyframe animation: two "+2 XP" toasts a second
   apart must retarget from where the first one is, and a keyframe would snap
   it back to the top of the animation instead. */
function toast(msg){
  const t=document.createElement('div');
  t.className='toast';t.setAttribute('role','status');t.setAttribute('aria-live','polite');
  t.innerHTML=msg;document.body.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('in'));
  setTimeout(()=>{t.classList.remove('in');t.classList.add('hide');setTimeout(()=>t.remove(),320)},2400);
}
/* ---------------- Helpers ---------------- */
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}

/* ---------------- Design layer helpers ---------------- */
/* Wide comparison tables scroll instead of breaking the reading column, and a
   cell that holds nothing but a number is right-aligned in tabular monospace so
   digit columns line up. Applied to the rendered HTML, so no chapter file,
   quiz question or past answer has to change. */
function enhanceContent(root){
  if(!root)return;
  root.querySelectorAll('table').forEach(tb=>{
    const p=tb.parentElement;
    if(!p||p.classList.contains('table-scroll'))return;
    const wrap=document.createElement('div');
    wrap.className='table-scroll';
    p.insertBefore(wrap,tb);wrap.appendChild(tb);
    // A long table gets a scrolling box and a pinned header so the column
    // titles stay visible while the numbers scroll.
    const rows=tb.querySelectorAll('tbody tr').length||tb.querySelectorAll('tr').length;
    if(rows>=9)wrap.classList.add('tall');
  });
  root.querySelectorAll('table td').forEach(td=>{
    if(td.classList.contains('num'))return;
    const t=td.textContent.trim();
    if(t&&t.length<=14&&/^[-+]?[\d][\d,]*\.?\d*%?$/.test(t))td.classList.add('num');
  });
  // A figure is drawn in its own coordinate space, so its labels are only as
  // legible as the scale it is finally rendered at. Each one gets a floor of
  // 100% of its own viewBox width - its designed size - and below that the
  // wrapper scrolls sideways instead of shrinking the drawing.
  //
  // That floor used to be 85%. It was measured against the figures and the two
  // longest ones - the Ch 1 twelve-step flowchart and the Ch 8 event loop -
  // were already sitting *on* the floor, so they were scrolling sideways AND
  // rendering their loop labels at 9.6px, which is below the 11px this site
  // promises nothing goes under. They were paying the scroll cost for nothing.
  // At 100% those labels render at their authored 11.5px. Measured across all
  // 163 figure labels: nothing below 11px now, against a 9.63px worst case.
  root.querySelectorAll('svg[viewBox]').forEach(sv=>{
    const w=parseFloat(String(sv.getAttribute('viewBox')).trim().split(/[\s,]+/)[2]);
    if(w>0)sv.style.setProperty('--fig-min',Math.round(w)+'px');
  });
  /* A bitmap figure - one of the teacher's slides, or a rendered page from a
     deck - has no viewBox, so there is no designed size to read off. It does
     have width and height attributes, written from each file's real size when
     the page was built, and those are known BEFORE the image decodes. That is
     what makes this pass synchronous.

     naturalWidth looked equivalent and was not. These images are `loading=lazy`,
     so an off-screen one has no naturalWidth at all: the floor was never set,
     the wrapper never overflowed, and the slide rendered at column width with no
     way to open it - on a phone, which is the one reader the floor exists for.
     Measured on Unit 8: twelve images, none loaded, none with a floor.

     The floor is a LEGIBILITY floor rather than a designed size, and capped at
     980px so a tablet or desktop column is never made to scroll a picture that
     would have fitted. Below that the true width wins. Under either, the wrapper
     scrolls and offers the full-screen viewer, exactly as a wide drawing does. */
  const IMG_FLOOR_MAX=980;
  root.querySelectorAll('figure img').forEach(img=>{
    const w=parseInt(img.getAttribute('width'),10)||img.naturalWidth;
    if(w>0)img.style.setProperty('--fig-min',Math.min(w,IMG_FLOOR_MAX)+'px');
  });
  syncScrollers(root);
}
/* The way into the full-screen viewer. It is a <button>, not a note: the text it
   replaces ("Scrolls sideways for the full figure") described a problem, and this
   is the same sentence with a solution attached. aria-label names the target
   because "View full screen" on its own does not say what of. */
function expandBtn(el,kind){
  const b=document.createElement('button');
  b.type='button';
  b.className='xv-open';
  b.innerHTML=icon('expand')+'<span>View full screen</span>';
  b.setAttribute('aria-label','View this '+kind+' full screen, with zoom and pan');
  b.onclick=()=>openExhibit(el,b);
  return b;
}
/* Wide exhibits - tables, figures, worked numericals - scroll sideways whenever
   the column is narrower than they are. Two things have to hold for that to be
   usable, and neither happens by itself.

   1. The region must be reachable without a mouse. Chromium does NOT put an
      overflow container in the tab order on its own: measured here, the Ch 1
      flowchart with 286px of itself off-screen reported tabIndex -1 and could be
      moved by drag and by nothing else, so a keyboard user could not read the
      half of a diagram that a phone reader sees by default. A tabindex plus a
      name (the documented focusable-scroll-region pattern) is the fix, and the
      name is why the region is announced as "Scrollable figure" rather than
      showing up as an unnamed box.

   2. A reader has to be able to tell the drawing continues. A figure that stops
      halfway across can read as a broken image rather than as "scroll me", so an
      overflowing figure's caption says so - and stops saying it as soon as the
      window is wide enough for the whole drawing, because a wide monitor should
      not carry a note about a problem it does not have.

   Both are decided from measurement rather than from a media query. Whether an
   exhibit overflows is a question about the column it landed in, not about the
   window: the same table fits at 900px with the drawer and scrolls at 1024px
   with the chapter list open. */
const SCROLL_LABEL={
  'figure-wrap':'Scrollable figure \u2014 use the arrow keys or drag to see all of it',
  'table-scroll':'Scrollable table \u2014 use the arrow keys or drag to see all of it'
};
function syncScrollers(root){
  const scope=root||document;
  scope.querySelectorAll('.figure-wrap,.table-scroll,.code-block,.formula-box,.worked').forEach(el=>{
    // Observing an element twice is a no-op, so this can run on every pass.
    if(scrollerRO)scrollerRO.observe(el);
    // Reading clientWidth forces layout once per element, so this pass is only
    // worth running where the answer can have changed: see the call sites.
    const over=el.scrollWidth-el.clientWidth>2;
    if(over){
      el.tabIndex=0;
      // A scrolling table wrapper, code block or worked example is a generic
      // element, and a name on a generic element is not announced - so it needs
      // a role to carry the name. A <figure> already has one and is left alone
      // (aria-label names the figure itself, which is exactly what is wanted).
      if(el.tagName!=='FIGURE'&&!el.hasAttribute('role'))el.setAttribute('role','group');
      if(!el.hasAttribute('aria-label')){
        const cls=[...el.classList].find(c=>SCROLL_LABEL[c]);
        el.setAttribute('aria-label',SCROLL_LABEL[cls]||'Scrollable content \u2014 use the arrow keys or drag to see all of it');
      }
    }else{
      // Nothing is hidden any more, so it is not a tab stop and not a named
      // region: all three attributes are this function's own, never the content's.
      el.removeAttribute('tabindex');
      el.removeAttribute('role');
      el.removeAttribute('aria-label');
    }
    /* Offer the whole picture when a THIRD OR MORE of an exhibit is off-screen,
       and stay quiet about the rest. A 2px overflow needs no affordance, and at
       390px Chapter 2 has ten tables that scroll - a button on every one of them
       would turn a control into a tic. A table missing a third of itself is a
       different thing from one missing its last digit.

       That leaves the lightly-overflowing exhibits without a button, which is
       why the second route in is a tap on the exhibit itself: a figure only has
       to be wider than its column to be worth opening whole, not a third wider.
       See the tap handler below openExhibit.

       Gated on `over` as well as on the two-thirds test, and not just as an
       optimisation. A collapsed answer or a hidden tab panel measures 0 wide AND
       0 of hidden content, and `0-0 >= 0/3` is TRUE - so the raw comparison
       counts every folded exhibit on the page as mostly hidden and plants a
       button in it. Resting on a positive width is what makes "a third is
       hidden" mean what it says. */
    const mostlyHidden=over&&el.scrollWidth-el.clientWidth>=el.scrollWidth/3;
    if(el.classList.contains('figure-wrap')){
      const btn=el.querySelector(':scope > .xv-open');
      // Above the drawing, not in the caption below it. A tall figure is 934px
      // in a 844px viewport, so a button under it is a button the reader has to
      // scroll a whole diagram to reach; the caption was chosen to keep the
      // affordance at the START of the horizontal scroller, and the top of the
      // figure is at that same edge without also being below the fold.
      if(mostlyHidden&&!btn)el.insertBefore(expandBtn(el,'figure'),el.firstChild);
      else if(btn&&!mostlyHidden)btn.remove();
    }else if(el.classList.contains('table-scroll')){
      const prev=el.previousElementSibling,btn=prev&&prev.classList.contains('xv-open')?prev:null;
      if(mostlyHidden&&!btn)el.parentNode.insertBefore(expandBtn(el,'table'),el);
      else if(btn&&!mostlyHidden)btn.remove();
    }
  });
}
let scrollerSyncT=0;
/* A drag-resize fires this on every frame and each pass reads layout, so settle
   first. 120ms is under the threshold where the change reads as lag. */
function queueScrollerSync(){clearTimeout(scrollerSyncT);scrollerSyncT=setTimeout(()=>syncScrollers(),120)}

/* ---------------- Full-screen exhibit viewer ----------------
   A figure is drawn at its designed width - 640 to 950px - and a phone column is
   about 278. So a phone reader sees 39-55% of a diagram at a time and has to
   scroll the page sideways 2.6 screens to read one whole; that is not reading,
   that is assembling. Tapping an exhibit that does not fit opens it here
   instead: the drawing is cloned in at its designed size, scaled to fit the
   screen, and the reader pans and pinches from that whole-picture start.

   It is a CLONE, not the original moved in. Moving the live node would leave the
   chapter short by one figure while the overlay is open - the page behind would
   reflow and the scroll position would jump on close - and it would put the
   reader's chapter at the mercy of a modal. Cloning costs one id-rewrite pass
   and changes nothing on the page at all.

   The transform lives on a zero-sized layer at the stage's origin, so "zoom
   about the point under my fingers" is one translate and one scale about (0,0)
   and the arithmetic below stays checkable by hand. */
const xvDlg=document.getElementById('exhibitViewer'),xvStage=document.getElementById('xvStage'),
      xvPan=document.getElementById('xvPan'),xvTitleEl=document.getElementById('xvTitle'),
      xvPctEl=document.getElementById('xvPct'),xvCloseBtn=document.getElementById('xvClose'),
      xvInBtn=document.getElementById('xvIn'),xvOutBtn=document.getElementById('xvOut'),
      xvFitBtn=document.getElementById('xvFit');
let xv=null,xvIdSeq=0,xvTrigger=null,xvMoved=0,xvLastTap=0,xvLastTapAt=null;
const xvPts=new Map();

/* Ids inside the clone have to be made unique. Every figure carries its arrowhead
   in a <defs> with an id, and its paths point at it with url(#fx) - so a second
   copy of that id in the document leaves the reference resolving to whichever of
   the two the browser meets first. Rewriting the ids and every reference to them
   keeps the clone self-contained, and 'self-contained' is what makes cloning safe
   for exhibits nobody has written yet. */
function rewriteIds(c){
  const map=new Map();
  const add=n=>{const old=n.id;if(!old)return;map.set(old,'xv'+(++xvIdSeq));n.id=map.get(old)};
  if(c.id)add(c);
  c.querySelectorAll('[id]').forEach(add);
  if(!map.size)return c;
  const fix=v=>v.replace(/url\(\s*#([^)\s'"]+)\s*\)/g,(m,id)=>map.has(id)?'url(#'+map.get(id)+')':m)
                  .replace(/^#([^#\s]+)$/,(m,id)=>map.has(id)?'#'+map.get(id):m);
  c.querySelectorAll('*').forEach(n=>{
    for(const a of [...n.attributes]){
      if(a.name==='id')continue;
      // aria-labelledby holds ids with no '#' in front, so it is a token list
      // rather than a reference URL and needs its own pass.
      const v=(a.name==='aria-labelledby'||a.name==='aria-describedby')
        ? a.value.split(/\s+/).map(t=>map.get(t)||t).join(' ')
        : fix(a.value);
      if(v!==a.value)n.setAttribute(a.name,v);
    }
  });
  return c;
}

/* The clone is sized to the exhibit's DESIGNED width, not to the column it
   happened to land in - that is the entire point of the overlay. For a figure
   that is its own viewBox; for a table it is the full width the in-page scroller
   was hiding, read off the wrapper before the clone is detached from it. */
function prepareClone(wrap){
  const isFig=wrap.classList.contains('figure-wrap');
  /* The exhibit is a DIRECT CHILD of the wrapper, and that is load-bearing.

     An <img> is a figure too, and leaving it out of this lookup made a bitmap
     figure unopenable - the button appeared, because the wrapper really did
     overflow, and the tap did nothing, because prepareClone found no source and
     returned null. A control that exists and does nothing is worse than none.

     Adding it as a third fallback after a bare `querySelector('svg')` looked
     right and was not: an overflowing figure's button is inserted as the FIRST
     child of the wrapper, and that button's icon is an <svg class="i">. So the
     fallback matched the 24x24 expand icon and opened the overlay holding it -
     measured, the pan layer contained `svg.i` with a 24px inline width, not the
     slide. Every lookup here is scoped to direct children, so chrome that lives
     inside a control cannot be mistaken for the exhibit. */
  const src=isFig?(wrap.querySelector('svg.figure')
               ||wrap.querySelector(':scope > img')
               ||wrap.querySelector(':scope > svg'))
              :wrap.querySelector('table');
  if(!src)return null;
  const c=rewriteIds(src.cloneNode(true));
  if(isFig){
    const vb=src.getAttribute('viewBox'),d=vb&&vb.trim().split(/[\s,]+/).map(Number);
    if(d&&d[2]>0&&d[3]>0){
      // box-sizing is border-box site-wide and .figure carries padding, so the
      // CONTENT box is what has to be the viewBox size for the drawing's labels
      // to render at the size they were authored at.
      c.style.boxSizing='content-box';
      c.style.width=d[2]+'px';
      c.style.height=d[3]+'px';
    }else if(src.tagName==='IMG'&&src.naturalWidth>0){
      // A bitmap's own pixels are its coordinate space the way a viewBox is a
      // drawing's. `loading=lazy` is dropped from the clone for the same reason
      // the size is set: a lazy image inside an overlay that is already open is
      // a picture that may never arrive, and an unsized one cannot be fitted.
      c.style.boxSizing='content-box';
      c.style.width=src.naturalWidth+'px';
      c.style.height=src.naturalHeight+'px';
      c.removeAttribute('loading');
    }
  }else{
    c.style.width=Math.max(wrap.scrollWidth,wrap.clientWidth)+'px';
  }
  // The in-page chrome (.figure's 560px cap, .table-scroll's margins) is about
  // fitting the column, and the column is what this overlay exists to escape.
  c.style.maxWidth='none';
  c.style.minWidth='0';
  c.style.margin='0';
  return c;
}

/* Pointer coordinates arrive in viewport space and the pan layer is positioned
   from the stage's origin, so every gesture has to be rebased or a phone's URL
   bar (and this dialog's own toolbar) lands in the middle of the zoom. */
function xvLocal(cx,cy){
  const r=xvStage.getBoundingClientRect();
  return{x:cx-r.left,y:cy-r.top};
}
/* Content smaller than the stage is centred; content larger is clamped to its own
   edges. Together those mean the drawing can never be flung off-screen and lost,
   which is the one failure a pan gesture has no way to recover from. */
function xvClamp(){
  const w=xv.cw*xv.s,h=xv.ch*xv.s;
  xv.tx=w<=xv.sw?(xv.sw-w)/2:Math.min(0,Math.max(xv.sw-w,xv.tx));
  xv.ty=h<=xv.sh?(xv.sh-h)/2:Math.min(0,Math.max(xv.sh-h,xv.ty));
}
function xvApply(){
  if(!xv)return;
  xv.s=Math.max(xv.min,Math.min(xv.max,xv.s));
  xvClamp();
  xvPan.style.transform='translate('+xv.tx.toFixed(2)+'px,'+xv.ty.toFixed(2)+'px) scale('+xv.s.toFixed(4)+')';
  xvPctEl.textContent=Math.round(xv.s/xv.fit*100)+'%';
  // aria-disabled rather than disabled: a control that switches itself off as you
  // reach for it takes the focus ring with it.
  const lim=(btn,at)=>btn.setAttribute('aria-disabled',at?'true':'false');
  lim(xvOutBtn,xv.s<=xv.min+1e-6);
  lim(xvInBtn,xv.s>=xv.max-1e-6);
  xvFitBtn.setAttribute('aria-disabled',xv.s<=xv.fit+1e-6?'true':'false');
}
function xvZoomAt(px,py,next){
  if(!xv)return;
  const s=Math.max(xv.min,Math.min(xv.max,next));
  if(s===xv.s)return;
  // The point of the drawing under the fingers stays under the fingers.
  const cx=(px-xv.tx)/xv.s,cy=(py-xv.ty)/xv.s;
  xv.s=s;xv.tx=px-cx*s;xv.ty=py-cy*s;
  xvApply();
}
function xvZoomBy(f,px,py){
  if(!xv)return;
  xvZoomAt(px==null?xv.sw/2:px,py==null?xv.sh/2:py,xv.s*f);
}
function xvReset(){if(!xv)return;xv.s=xv.fit;xvApply()}

function xvTitleFor(wrap){
  // Both buttons are SIBLINGS of the drawing, never inside it, so the caption is
  // still just the caption and can be read straight out.
  const cap=wrap.querySelector('figcaption')||wrap.querySelector('caption');
  if(cap){
    const t=cap.textContent.replace(/\s+/g,' ').trim();
    if(t)return t;
  }
  const sec=wrap.closest('.learn-sec');
  const h=sec&&sec.querySelector('h2');
  if(h){const t=h.textContent.replace(/\s+/g,' ').trim();if(t)return t}
  return wrap.classList.contains('figure-wrap')?'Figure':'Table';
}

function openExhibit(wrap,trigger){
  if(!wrap||xvDlg.open)return false;
  const node=prepareClone(wrap);
  if(!node)return false;
  xvTitleEl.textContent=xvTitleFor(wrap);
  xvPan.textContent='';
  xvPan.appendChild(node);
  if(typeof xvDlg.showModal==='function')xvDlg.showModal();else xvDlg.setAttribute('open','');
  // The chapter behind must not move while the overlay is up: on a phone the two
  // are the same surface, and a stray drag off the stage would scroll the notes.
  document.documentElement.classList.add('xv-locked');
  // Measured with the dialog already open (a closed dialog has no stage) and with
  // the transform cleared, or offsetWidth would report the last scaled box.
  xvPan.style.transform='none';
  const cw=node.offsetWidth||node.scrollWidth,ch=node.offsetHeight||node.scrollHeight,
        sw=xvStage.clientWidth,sh=xvStage.clientHeight;
  if(!cw||!ch||!sw||!sh){closeExhibit();return false}
  const fit=Math.min(sw/cw,sh/ch);
  xv={cw,ch,sw,sh,fit,min:fit,max:Math.max(fit*8,3),s:fit,tx:0,ty:0};
  xvReset();
  xvTrigger=trigger||null;
  // Focus the way out rather than the first zoom button: the first thing a
  // reader wants confirmed is that they can leave.
  xvCloseBtn.focus();
  return true;
}
function xvTeardown(){
  xvPan.textContent='';
  xvPan.style.transform='none';
  document.documentElement.classList.remove('xv-locked');
  xvStage.classList.remove('grabbing');
  xvPts.clear();
  xv=null;
  const t=xvTrigger;
  xvTrigger=null;
  // Back to the button that opened it, so the reader lands where they left off
  // rather than at the top of the document.
  if(t&&document.contains(t))t.focus();
}
function closeExhibit(){
  // Closed first so the overlay leaves the top layer in this same task - tearing
  // down first would show one frame of an empty stage - and then the state is
  // cleared immediately rather than waiting for an event to come back.
  if(xvDlg.open)xvDlg.close();
  xvTeardown();
}
/* Every way out of the dialog ends the same way - the close button, Escape (which
   the engine handles itself, without my code running at all) and a tap on the
   empty stage - and only the first is a click of mine. What all three share is
   the `open` attribute going away, so that is the thing to watch.

   Watching the ATTRIBUTE rather than the dialog's `close` event is a fix, not
   belt-and-braces. Measured in the desktop app's embedded browser (Electron 33 /
   Chromium 130): close() removes `open` and sets dialog.open to false WITHOUT
   ever dispatching `close` - for a bare <dialog> as well as for this one, so it
   is the build and not the markup. A teardown hung off that event leaves the
   chapter locked against scrolling with no way back, which is exactly what it
   did until this observer replaced it. The event is deliberately not used. */
new MutationObserver(()=>{if(!xvDlg.open)xvTeardown()}).observe(xvDlg,{attributeFilter:['open']});
xvCloseBtn.onclick=()=>closeExhibit();
xvInBtn.onclick=()=>{if(xvInBtn.getAttribute('aria-disabled')!=='true')xvZoomBy(1.3)};
xvOutBtn.onclick=()=>{if(xvOutBtn.getAttribute('aria-disabled')!=='true')xvZoomBy(1/1.3)};
xvFitBtn.onclick=()=>xvReset();

/* Pan and pinch. Pointer events cover mouse, touch and pen with one code path,
   and the pointer set is a Map so a third finger landing mid-pinch does not
   scramble the two that are doing the work. */
xvStage.addEventListener('pointerdown',ev=>{
  if(!xv)return;
  xvStage.setPointerCapture(ev.pointerId);
  xvPts.set(ev.pointerId,{x:ev.clientX,y:ev.clientY});
  xvMoved=0;
  xvStage.classList.add('grabbing');
  ev.preventDefault();
});
xvStage.addEventListener('pointermove',ev=>{
  if(!xv||!xvPts.has(ev.pointerId))return;
  const was=xvPts.get(ev.pointerId),before=new Map(xvPts);
  xvPts.set(ev.pointerId,{x:ev.clientX,y:ev.clientY});
  ev.preventDefault();
  xvMoved+=Math.abs(ev.clientX-was.x)+Math.abs(ev.clientY-was.y);
  const pts=[...xvPts.values()];
  if(pts.length===1){
    xv.tx+=pts[0].x-was.x;
    xv.ty+=pts[0].y-was.y;
    xvApply();
    return;
  }
  if(pts.length===2&&before.size===2){
    const p=[...before.values()];
    const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
    const m0=mid(p[0],p[1]),m1=mid(pts[0],pts[1]);
    const d0=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)||1,
          d1=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y)||1;
    const l=xvLocal(m1.x,m1.y);
    // Scale about the fingers' midpoint first, then follow the midpoint: that
    // order is what makes a pinch feel attached to the drawing.
    xvZoomAt(l.x,l.y,xv.s*(d1/d0));
    xv.tx+=m1.x-m0.x;
    xv.ty+=m1.y-m0.y;
    xvApply();
  }
});
function xvRelease(ev){
  const had=xvPts.get(ev.pointerId);
  xvPts.delete(ev.pointerId);
  if(!xvPts.size)xvStage.classList.remove('grabbing');
  if(!xv||!had)return;
  // Double-tap toggles the whole picture and twice it, zoomed where the finger
  // landed - the fastest route from "too small to read" to "big enough".
  if(xvMoved>10||xvPts.size){
    xvLastTap=0;xvLastTapAt=null;return;
  }
  const now=Date.now(),l=xvLocal(ev.clientX,ev.clientY);
  if(xvLastTapAt&&now-xvLastTap<320&&Math.hypot(l.x-xvLastTapAt.x,l.y-xvLastTapAt.y)<32){
    xvLastTap=0;xvLastTapAt=null;
    if(xv.s>xv.fit*1.15)xvReset();
    else xvZoomAt(l.x,l.y,xv.fit*2);
  }else{
    xvLastTap=now;xvLastTapAt=l;
  }
}
xvStage.addEventListener('pointerup',xvRelease);
xvStage.addEventListener('pointercancel',xvRelease);
/* Wheel and trackpad pinch share one curve. A trackpad pinch arrives as a wheel
   with ctrlKey set and much smaller deltas, hence the stronger constant - and the
   page must not scroll behind it, hence preventDefault on a non-passive listener. */
xvStage.addEventListener('wheel',ev=>{
  if(!xv)return;
  ev.preventDefault();
  const l=xvLocal(ev.clientX,ev.clientY);
  xvZoomAt(l.x,l.y,xv.s*Math.exp(-ev.deltaY*(ev.ctrlKey?0.01:0.0018)));
},{passive:false});
/* Tap the empty part of the stage to leave. Guarded on xvMoved because a pan also
   ends in a click when the finger went down and up on the same element - without
   the guard, every pan would close the viewer. */
xvDlg.addEventListener('click',ev=>{
  if(xvMoved>10)return;
  if(ev.target===xvDlg||ev.target===xvStage||ev.target===xvPan)closeExhibit();
});
xvDlg.addEventListener('keydown',ev=>{
  if(!xv)return;
  const step=48;
  let hit=true;
  switch(ev.key){
    case '+':case '=':xvZoomBy(1.25);break;
    case '-':case '_':xvZoomBy(1/1.25);break;
    case '0':xvReset();break;
    case 'ArrowLeft':xv.tx+=step;xvApply();break;
    case 'ArrowRight':xv.tx-=step;xvApply();break;
    case 'ArrowUp':xv.ty+=step;xvApply();break;
    case 'ArrowDown':xv.ty-=step;xvApply();break;
    default:hit=false;
  }
  if(hit)ev.preventDefault();
});

/* The second way in, and the one that covers the exhibits the metered button rule
   leaves alone: a tap on the exhibit itself. What separates a tap from the two
   gestures that share it is movement and selection. A sideways drag to scroll, a
   press-and-hold to select a row of figures, a click on a citation chip or a
   summary inside the exhibit - all of them end in a click event, and none of them
   means "open this". */
let xvTapAt=null,xvTapT=0;
const contentEl=document.getElementById('contentArea');
contentEl.addEventListener('pointerdown',ev=>{xvTapAt={x:ev.clientX,y:ev.clientY};xvTapT=Date.now()},true);
contentEl.addEventListener('click',ev=>{
  if(xvDlg.open)return;
  const t=ev.target;
  const sc=t&&t.closest?t.closest('.figure-wrap,.table-scroll'):null;
  if(!sc||!xvTapAt)return;
  if(t.closest('a,button,summary,input,label,select,textarea,[data-page]'))return;
  if(Math.abs(ev.clientX-xvTapAt.x)>8||Math.abs(ev.clientY-xvTapAt.y)>8)return;
  if(Date.now()-xvTapT>800)return;   // a long press is a selection, not a tap
  const sel=window.getSelection&&window.getSelection();
  if(sel&&!sel.isCollapsed)return;
  if(sc.scrollWidth-sc.clientWidth<=2)return;   // nothing hidden, nothing to open
  openExhibit(sc,null);
},true);

/* Whether an exhibit overflows is a property of the box it was handed, so the
   thing worth listening to is the box changing - not the click that caused it.

   This replaces a click listener on the content area, which only ever saw the
   reveals a person made by hand. The PROGRAMMATIC ones went unnoticed: the
   Expand/Collapse-all buttons and a search result that opens the past question it
   matched both expand answers without firing a click inside the content area.
   Measured at 360px, two past-question tables in Chapter 1 that hide 45% and 55%
   of themselves opened with no note and no tabindex - reachable again only by
   dragging. A ResizeObserver sees every route to the change instead: a folded
   answer opening (0x0 becomes 278x620), a panel becoming the visible one, a
   window resize.

   The callback only queues. The pass mutates the DOM - a figure's note adds a
   line to its caption, which changes the figure's height - and mutating an
   observed element from inside its own ResizeObserver callback is how you land
   the "loop completed with undelivered notifications" error. */
const scrollerRO='ResizeObserver' in window?new ResizeObserver(()=>queueScrollerSync()):null;
/* ---------------- Chapter sections ---------------- */
/* A chapter is 30-60 screens of notes. Each h2 section gets its own chevron so
   one section can be folded away, and the chapter carries one Expand/Collapse
   All control. Sections start expanded: nothing is hidden unless asked. */
function buildSections(){
  const box=document.querySelector('#panel-learn .learn-content');
  if(!box||box.dataset.secs==='1')return;
  const kids=[...box.childNodes];
  let sec=null;
  kids.forEach(node=>{
    if(node.nodeType===1&&node.tagName==='H2'){
      sec=document.createElement('section');
      sec.className='learn-sec';
      box.insertBefore(sec,node);
      const head=document.createElement('div');
      head.className='sec-head';
      sec.appendChild(head);
      head.appendChild(node);
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='sec-toggle';
      btn.title='Collapse or expand this section';
      btn.setAttribute('aria-expanded','true');
      btn.innerHTML=icon('chevron','caret');
      const target=sec;              // capture: `sec` moves on to the next heading
      btn.onclick=()=>toggleSection(target);
      head.appendChild(btn);
      return;
    }
    if(sec)sec.appendChild(node);
  });
  box.dataset.secs='1';
  const key=NS+'-collapsed-'+cur;
  let stored=[];
  try{stored=JSON.parse(localStorage.getItem(key)||'[]')}catch(e){stored=[]}
  box.querySelectorAll('section.learn-sec').forEach((s,i)=>{if(stored.includes(i))setSection(s,false,false)});
}
function setSection(sec,open,remember){
  sec.classList.toggle('collapsed',!open);
  const b=sec.querySelector('.sec-toggle');
  if(b)b.setAttribute('aria-expanded',open?'true':'false');
  if(remember!==false){
    const all=[...document.querySelectorAll('#panel-learn section.learn-sec')];
    const idx=all.map(s=>s.classList.contains('collapsed'));
    try{localStorage.setItem(NS+'-collapsed-'+cur,JSON.stringify(idx.map((v,i)=>v?i:-1).filter(i=>i>=0)))}catch(e){}
  }
}
function toggleSection(sec){setSection(sec,sec.classList.contains('collapsed'))}
function setAllSections(open){
  document.querySelectorAll('#panel-learn section.learn-sec').forEach(s=>setSection(s,open,false));
  try{localStorage.setItem(NS+'-collapsed-'+cur,JSON.stringify(open?[]:[...document.querySelectorAll('#panel-learn section.learn-sec')].map((s,i)=>i)))}catch(e){}
  toast(open?'All sections expanded':'All sections collapsed');
}
/* Tab badges: what is behind each tab, and whether it is finished. The quiz
   badge turns green and shows the stored score once the chapter quiz is done. */
function updateTabBadges(){
  const progress=Progress.state();
  const c=CH[cur]||{},done=!!progress.done[cur],score=(progress.chapterQuiz||{})[cur];
  const set=(sel,text,cls,show)=>{
    const el=document.querySelector(sel);
    if(!el)return;
    el.textContent=text;
    el.className='tab-badge'+(cls?' '+cls:'');
    el.hidden=!show;
  };
  set('[data-badge="learn"]',done?'✓':'','done',done);
  set('[data-badge="quiz"]',score?score.pct+'%':String((c.quiz||[]).length||''),score?'done':'accent',(c.quiz||[]).length>0);
  set('[data-badge="past"]',String((c.past||[]).length||''),'accent',(c.past||[]).length>0);
}

/* ---------------- Analysis tab ---------------- */
function bankCounts(){
  let answered=0,pending=0,total=0,repeated=0;
  for(let n=1;n<=N;n++){const c=CH[n];if(!c)continue;(c.past||[]).forEach(q=>{total++;q.answer?answered++:pending++;if((q.repeats||1)>=2)repeated++})}
  return{answered,pending,total,repeated}
}
function renderAnalysis(){
  const A=window.ANALYSIS||{};const el=document.getElementById('panel-analysis');
  const progress=Progress.state();
  const b=bankCounts();
  const doneCount=Object.keys(progress.done||{}).length;
  const acc=progress.totalQ>0?Math.round(progress.correctQ/progress.totalQ*100):0;
  let masterySum=0,masteryN=0;
  for(let n=1;n<=N;n++){const cq=(progress.chapterQuiz||{})[n];if(cq){masterySum+=(cq.pct||0);masteryN++}}
  const mastery=masteryN?Math.round(masterySum/N):0;
  let h='';
  h+='<div class="an-grid">'+
    card('Chapters read',doneCount+'/'+N,'marked complete')+
    card('Quiz accuracy',acc+'%',progress.correctQ+' of '+progress.totalQ+' answered correctly')+
    card('Question bank',b.answered+'/'+b.total,'past questions with a model answer'+(b.pending?' · '+b.pending+' practice-only':''))+
    card('Repeated questions',b.repeated,'asked in 2 or more papers')+
  '</div>';
  h+='<div class="an-sec"><h3>'+icon('target')+' Chapter mastery</h3>';
  for(let n=1;n<=N;n++){
    const m=meta[n-1],cq=(progress.chapterQuiz||{})[n],done=progress.done[n];
    let pct=cq?(cq.pct||0):0;
    if(done)pct=Math.round((pct+100)/2);
    h+=bar('Ch '+n+' · '+m.t.slice(0,18)+(done?' ✓':''),pct,cq?(cq.correct+'/'+cq.total+' quiz'):'not attempted');
  }
  h+='<div class="an-btns"><button class="an-btn" onclick="APP.exportProgress()">'+icon('download')+' Export progress</button>'+
     '<button class="an-btn" onclick="APP.importProgress(\'merge\')">'+icon('upload')+' Import (merge)</button>'+
     '<button class="an-btn" onclick="APP.importProgress(\'replace\')">'+icon('upload')+' Import (replace)</button>'+
     '<button class="an-btn danger" onclick="APP.resetProgress()">'+icon('trash')+' Reset</button></div></div>';
  if(A.topics&&A.topics.length){
    h+='<div class="an-sec"><h3>'+icon('repeat')+' Most repeated topics <span class="pq-count">the top '+A.topics.length+' of '+A.total_questions+' past questions, across '+A.papers.length+' papers</span></h3>';
    A.topics.forEach(t=>{h+=topicRow(t)});
    h+='</div>';
  }
  if(A.year_distribution){
    const yrs=Object.keys(A.year_distribution),max=Math.max(...Object.values(A.year_distribution));
    h+='<div class="an-sec"><h3>'+icon('calendar')+' Year-wise distribution</h3>';
    yrs.forEach(y=>{h+=bar(y,Math.round(A.year_distribution[y]/max*100),A.year_distribution[y]+' questions')});
    h+='<p style="font-size:11.5px;color:var(--t3);margin-top:10px">Papers analysed: '+esc(A.papers.join(', '))+'. A question listed in two papers is counted in both.</p></div>';
  }
  if(A.chapters){
    h+='<div class="an-sec"><h3>'+icon('layers')+' Bank coverage per chapter</h3><div class="table-scroll"><table><thead><tr><th>Chapter</th><th class="num">Weight</th><th class="num">Bank questions</th><th class="num">On the site</th><th class="num">Answered</th></tr></thead><tbody>';
    Object.keys(A.chapters).sort((a,b2)=>a-b2).forEach(k=>{
      const c=A.chapters[k],site=CH[k]?(CH[k].past||[]).filter(q=>q.answer).length:0;
      h+='<tr><td>Ch '+k+' — '+esc(c.title)+'</td><td class="num">'+c.weight+'</td><td class="num">'+c.questions+'</td><td class="num">'+((CH[k]&&CH[k].past||[]).length)+'</td><td class="num">'+site+'</td></tr>';
    });
    h+='</tbody></table></div></div>';
  }
  if(A.strategy&&A.strategy.length){
    h+='<div class="strategy-box"><h3>'+icon('alert')+' Exam strategy notes</h3>';
    A.strategy.forEach(s=>{h+='<h4>'+esc(s.heading)+'</h4><ul>'+s.items.map(i=>'<li>'+esc(i)+'</li>').join('')+'</ul>'});
    h+='</div>';
  }
  el.innerHTML=h;
}
function card(k,v,s){return '<div class="an-card"><div class="k">'+k+'</div><div class="v">'+v+'</div><div class="s">'+esc(s)+'</div></div>'}
function bar(lbl,pct,val){pct=Math.max(0,Math.min(100,pct||0));return '<div class="bar-row"><span class="lbl" title="'+esc(lbl)+'">'+esc(lbl)+'</span><span class="bar-track"><span class="bar-fill" style="width:'+pct+'%"></span></span><span class="val" title="'+esc(val)+'">'+esc(val)+'</span></div>'}
function topicsPct(t){const m=String(t).match(/\d+/g);if(!m)return 20;const v=+m[0];return Math.round(v/12*100)}
function topicRow(t){
  const ch=String(t.chapter).replace(/\D/g,'');
  return '<div class="topic-row"><span class="t-lbl"><strong>#'+t.rank+'</strong> <span class="t-ch">Ch '+ch+'</span> '+esc(t.topic)+'</span>'+
    '<span class="bar-track"><span class="bar-fill" style="width:'+topicsPct(t.times)+'%"></span></span>'+
    '<span class="t-val">'+esc(t.times)+' times</span></div>';
}

/* ---------------- Nav ---------------- */
function buildNav(){
  const progress=Progress.state();
  document.getElementById('chNav').innerHTML=meta.map(c=>{
    const done=progress.done[c.n];
    const seen=!!(progress.seen||{})[c.n];
    const state=done?' done':(seen?' progress':'');
    const score=(progress.chapterQuiz||{})[c.n];
    const stateWord=done?', completed':(seen?', in progress':'');
    // A real link, not a div with a click handler: the URL changes, Back works,
    // and middle-click / "copy link address" mean the chapter list behaves the
    // way a list of chapters should. aria-current is set only on the one you are
    // in, so a screen reader says "current page" instead of "1 of 8 buttons".
    return `<a class="nav-item${state}" data-ch="${c.n}" href="#/ch/${c.n}"${c.n===cur?' aria-current="page"':''} aria-label="Chapter ${c.n}: ${c.t}, ${c.m} marks${stateWord}"><span class="nav-num" aria-hidden="true">${done?'✓':c.n}</span><span class="nav-label">${c.t}</span><div class="nav-meta"><span class="nav-marks">${c.m}m</span>${score?`<span class="nav-quiz">${score.pct}%</span>`:''}</div></a>`;
  }).join('');
}
function load(n,opts){
  opts=opts||{};
  const progress=Progress.state();
  cur=n;const ch=CH[n],m=meta[n-1];
  if(!progress.seen)progress.seen={};
  if(!progress.seen[n]){progress.seen[n]=true;buildNav();Progress.save()}
  document.querySelectorAll('.nav-item').forEach(el=>{
    const on=+el.dataset.ch===n;
    el.classList.toggle('active',on);
    // aria-current is "the page I am on", so it is present or absent - never "false".
    if(on)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
  });
  document.getElementById('chNo').textContent='Ch '+n;
  document.getElementById('chTi').textContent=m.t;
  document.getElementById('chBd').textContent=m.m+' marks · '+m.h+' hrs';
  switchTab(opts.tab||'learn',{silent:true});
  if(!ch){document.getElementById('panel-learn').innerHTML='<p style="color:var(--t3)">Loading…</p>';return;}
  const done=!!progress.done[n];
  const doneHtml=`<div class="ch-complete-bar"><div class="label">${done?icon('check')+' <em>Chapter completed.</em>':'Finished reading this chapter?'}</div><button class="mark-done-btn ${done?'completed':'todo'}" onclick="APP.markDone(${n})">${done?icon('check')+' Completed':'Mark as complete <span style="opacity:.7">+10 XP</span>'}</button></div>`;
  const tools='<div class="learn-tools">'+
      '<button class="an-btn" onclick="APP.sections(true)">'+icon('chevron')+' Expand all</button>'+
      '<button class="an-btn" onclick="APP.sections(false)">'+icon('chevronUp')+' Collapse all</button>'+
      '<span class="meta">'+(ch.quiz||[]).length+' quiz questions · '+(ch.past||[]).length+' past questions · '+m.h+' hrs of lectures</span>'+
    '</div>';
  document.getElementById('panel-learn').innerHTML=tools+'<div class="learn-content">'+ch.learn+doneHtml+'</div>';
  buildSections();
  Quiz.render(n,ch.quiz||[]);
  Past.render(ch.past||[],ch.pastSummary||'');
  enhanceContent(document.getElementById('panel-learn'));
  enhanceContent(document.getElementById('panel-past'));
  updateTabBadges();
  setDrawer(false);
  const area=document.getElementById('contentArea');
  area.scrollTop=0;
  syncFabWrap();
  // Navigating to another chapter is a page change: the person should land on
  // the new content, not stay stranded in the sidebar they clicked from.
  // Skipped on the boot load so the page does not grab focus by itself.
  if(ready&&opts.focus!==false)area.focus({preventScroll:true});
  // Loading a chapter is what addresses it, so the address bar always matches
  // what is on screen - even when the change came from a button, not a link.
  if(!opts.silent)writeRoute({tab:opts.tab||'learn',ch:n});
}
function markDone(n){
  const progress=Progress.state();
  if(progress.done[n])return;
  progress.done[n]=true;progress.xp+=10;Progress.save();Progress.updateStats();
  buildNav();load(n);toast(icon('check')+' Chapter '+n+' complete · +10 XP');
}
function switchTab(t,opts){
  document.querySelectorAll('.tab-btn').forEach(b=>{
    const on=b.dataset.tab===t;
    b.classList.toggle('active',on);
    b.setAttribute('aria-selected',on?'true':'false');
    // Roving tabindex: the five views are one stop in the tab order, and the
    // arrow keys walk along them (the ARIA tabs pattern).
    b.tabIndex=on?0:-1;
  });
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id==='panel-'+t));
  document.getElementById('contentArea').scrollTop=0;
  /* On a narrow window the strip scrolls sideways, and its scrollbar is hidden
     (scrollbar-width:none) - so the tab you just picked can sit entirely
     off-screen with nothing to say the strip moved, and a deep link can open on
     a tab the reader never sees selected. Park the active tab in the middle.
     Measured with rects rather than offsetLeft: .tabs is not positioned, so
     offsetLeft would be relative to whichever ancestor happens to be. Inert at
     any width where the strip fits, which is every desktop window. */
  const tabBar=document.querySelector('.tabs'),tabOn=tabBar&&tabBar.querySelector('.tab-btn.active');
  if(tabBar&&tabOn&&tabBar.scrollWidth>tabBar.clientWidth){
    const b=tabBar.getBoundingClientRect(),a=tabOn.getBoundingClientRect();
    tabBar.scrollLeft+=(a.left-b.left)-(b.width-a.width)/2;
  }
  if(t==='analysis')renderAnalysis();
  if(t==='exam'&&Exam)Exam.render();
  /* Last, and after the tab's own renderer: a panel that is display:none
     measures 0 for both scrollWidth and clientWidth, so the exhibits in a panel
     are only measurable once it is the visible one - and the Analysis tables
     only exist after renderAnalysis() has drawn them. */
  syncScrollers(document.getElementById('panel-'+t));
  if(!(opts&&opts.silent))writeRoute({tab:t,ch:cur});
}
function activeTab(){
  const b=document.querySelector('.tab-btn.active');
  return (b&&b.dataset.tab)||'learn';
}

/* ---------------- The URL is the location ---------------- */
/* Every view is addressable (SM.parseRoute / SM.formatRoute in engine.js), so
   "Ch 6, the question I keep getting wrong" is a link: bookmark it, send it to
   a classmate, open it on a phone and land on the same card. Without this a
   refresh dropped you back on chapter 1, tab Learn, which is the single most
   annoying thing a study site can do.

   A navigation the user made pushes a history entry (that is what Back is for);
   the first paint replaces instead, so Back leaves the site rather than
   bouncing through #/ch/1. */
function writeRoute(route,replace){
  const h=SM.formatRoute(route);
  if(location.hash===h)return;
  if(replace&&window.history&&history.replaceState)history.replaceState(null,'',h);
  else location.hash=h;
}
/* One entry point for "show me this view", whether that came from a link, a
   button, the browser's Back or a fresh load. `fromHash` marks the last case, so
   we never write the hash back at ourselves. */
function go(route,opts){
  const fromHash=!!(opts&&opts.fromHash);
  const r=route||{};
  const tab=r.tab||'learn';
  const ch=r.ch||cur;
  if(r.ch&&r.ch!==cur)load(ch,{tab,silent:true,fromHash});
  else switchTab(tab,{silent:true});
  if(r.q!=null)openPastQuestion(r.q);
  if(!fromHash)writeRoute({tab,ch,q:r.q==null?null:r.q});
}
/* A #/q/<ch>-<i> link lands on one past question, answer revealed and flashed. */
function openPastQuestion(i){
  if(!App.Past.openOne(i))return;
  const card=document.getElementById('pq-'+i);
  if(card&&card.scrollIntoView)card.scrollIntoView({block:'center'});
  card.classList.add('mark-flash');
  setTimeout(()=>card.classList.remove('mark-flash'),2600);
}
function onHash(){
  const r=SM.parseRoute(location.hash);
  if(!r){
    // A hand-mangled hash is not an error state: put the address bar back in step
    // with the view instead of leaving a dead link on screen.
    writeRoute({tab:activeTab(),ch:cur},true);
    return;
  }
  // Our own writes also fire hashchange. Skip the route we are already showing,
  // so a tab click does not re-render the exam paper a second time behind itself.
  if(activeTab()===r.tab&&(r.ch==null||r.ch===cur)&&r.q==null)return;
  go(r,{fromHash:true});
}

/* Events */
/* One button, two jobs: on a laptop it compresses the sidebar to a rail of
   chapter numbers (remembered between visits); under 1025 px the sidebar is a
   drawer and the same button opens it. */
const appEl=document.querySelector('.app'),sideEl=document.getElementById('sidebar'),menuEl=document.getElementById('menuBtn');
const isDrawer=()=>window.matchMedia('(max-width:1024px)').matches;
function syncMenuBtn(){
  const on=isDrawer()?sideEl.classList.contains('open'):!appEl.classList.contains('rail');
  menuEl.setAttribute('aria-expanded',on?'true':'false');
  // The same button is a paperclip in a rail and a cross on a drawer, so its
  // face changes with the layout - set as markup, not text, or the icon is
  // replaced by its own name.
  const openDrawer=isDrawer()&&sideEl.classList.contains('open');
  menuEl.innerHTML=openDrawer?icon('x'):icon('menu');
}
function setRail(on,remember){
  appEl.classList.toggle('rail',on);
  menuEl.setAttribute('aria-expanded',on?'false':'true');
  menuEl.title=on?'Show the full chapter list':'Compress the chapter list';
  if(remember!==false){try{localStorage.setItem(NS+'-rail',on?'1':'0')}catch(e){}}
  syncMenuBtn();
}
/* The mobile drawer. Opening it moves focus into it, Escape closes it and hands
   focus back to the button that opened it, and the content behind it goes
   `inert` so Tab cannot wander into a page hidden under the overlay. The topbar
   stays live: the ✕ and the search box are how you get out. */
function setDrawer(open){
  if(open&&!isDrawer())return;
  sideEl.classList.toggle('open',open);
  document.getElementById('overlay').classList.toggle('show',open);
  const behind=[document.getElementById('contentArea'),document.querySelector('.tabs')];
  behind.forEach(el=>{if(el)el.inert=open});
  syncMenuBtn();
  if(open){
    const first=sideEl.querySelector('.nav-item.active')||sideEl.querySelector('.nav-item');
    if(first)first.focus();
  }
}
function closeDrawer(){
  if(!sideEl.classList.contains('open'))return false;
  setDrawer(false);
  return true;
}
menuEl.onclick=()=>{
  if(isDrawer())setDrawer(!sideEl.classList.contains('open'));
  else setRail(!appEl.classList.contains('rail'));
  syncMenuBtn();
};
document.getElementById('overlay').onclick=()=>{if(closeDrawer())menuEl.focus()};
window.addEventListener('resize',()=>{
  if(!isDrawer())closeDrawer();
  syncMenuBtn();
  // The ResizeObserver watches every exhibit already, but a browser without one
  // still has to re-decide this when the window changes.
  if(!scrollerRO)queueScrollerSync();
});
document.addEventListener('keydown',ev=>{
  if(ev.key==='Escape'&&closeDrawer())menuEl.focus();
});
document.querySelectorAll('.tab-btn').forEach(b=>b.onclick=()=>go({tab:b.dataset.tab,ch:cur}));
/* Arrow keys move along the tab strip (automatic activation - every panel is
   cheap to draw), and Home/End jump to the ends like a listbox. */
document.querySelector('.tabs').addEventListener('keydown',ev=>{
  const btns=[...document.querySelectorAll('.tab-btn')];
  const i=btns.indexOf(document.activeElement);
  if(i<0)return;
  let j=null;
  if(ev.key==='ArrowRight')j=(i+1)%btns.length;
  else if(ev.key==='ArrowLeft')j=(i-1+btns.length)%btns.length;
  else if(ev.key==='Home')j=0;
  else if(ev.key==='End')j=btns.length-1;
  if(j===null)return;
  ev.preventDefault();
  btns[j].focus();
  btns[j].click();
});
/* Persistent jump-to-top / next-chapter affordance: navigation should not live
   only in the sidebar. */
document.getElementById('fabTop').onclick=()=>document.getElementById('contentArea').scrollTo({top:0,behavior:'smooth'});
document.getElementById('fabNext').onclick=()=>load(cur<8?cur+1:1);
/* The floating controls belong to a page you are already reading, so they
   appear once the reader has moved into the chapter and stay out of the way
   until then. At the top of a chapter they would be two circles covering the
   first paragraph to offer "go up" and "go down". */
const fabWrap=document.querySelector('.fab-wrap');
function syncFabWrap(){
  const on=document.getElementById('contentArea').scrollTop>220;
  fabWrap.classList.toggle('show',on);
}
document.getElementById('contentArea').addEventListener('scroll',syncFabWrap,{passive:true});
/* Keyboard access: the past-question headers and the quiz options are divs with
   click handlers, so give them Enter/Space support to match the buttons. (The
   chapter list no longer needs this - it is made of real links.) */
function wireKeys(){
  document.getElementById('panel-past').addEventListener('keydown',ev=>{
    const el=ev.target.closest('.pq-question');
    if(!el||!(ev.key==='Enter'||ev.key===' '))return;
    ev.preventDefault();el.click();
  });
  document.getElementById('contentArea').addEventListener('keydown',ev=>{
    const el=ev.target.closest('.q-option');
    if(!el||!(ev.key==='Enter'||ev.key===' '))return;
    ev.preventDefault();el.click();
  });
}

/* Source pages. The pages of the class notes the site's numbers were read off
   are copied in web-sized (tools/build_note_pages.py) and every citation is a
   chip carrying data-page="n2p58". One capture-phase handler covers the notes'
   own chips and the ones the past-question cards render, so adding a citation
   is markup rather than code - and capture is what stops a chip inside a
   past-question header from also toggling the question open. */
const pageDlg=document.getElementById('pageViewer'),pageImg=document.getElementById('pvImg'),
      pageTitle=document.getElementById('pvTitle'),pageOpen=document.getElementById('pvOpen');
function openPage(id){
  const p=(window.NOTE_PAGES||{})[id];
  if(!p){toast('No page "'+id+'" in the notes index');return false}
  pageImg.src=p.f;
  pageImg.hidden=false;   // the alt text is only correct once p is known
  pageImg.alt='Class notes, '+p.p+' — '+p.t;
  pageTitle.textContent=p.p+' — '+p.t;
  pageOpen.href=p.f;
  if(typeof pageDlg.showModal==='function')pageDlg.showModal();
  else pageDlg.setAttribute('open','');   // engines without <dialog>: still shown
  return true;
}
document.getElementById('pvClose').onclick=()=>pageDlg.close();
// A click on the backdrop has the dialog itself as its target, so it dismisses.
pageDlg.addEventListener('click',ev=>{if(ev.target===pageDlg)pageDlg.close()});
document.addEventListener('click',ev=>{
  const chip=ev.target.closest('[data-page]');
  if(!chip)return;
  ev.preventDefault();ev.stopPropagation();
  if(!openPage(chip.dataset.page)&&!pageDlg.open)return;
},true);

/* ---------------- The API the feature modules call back into ---------------- */
App.Shell={meta,chapters:()=>CH,cur:()=>cur,esc,shuffle,enhanceContent,toast,icon,ICONS,
  updateTabBadges,buildNav,load,switchTab,go,activeTab,setSection,renderAnalysis,bar};

/* Boot: the hash decides where you land, so a bookmark or a refresh reopens the
   view you were reading rather than chapter 1. */
let ready=false;
buildNav();Progress.updateStats();Search.build();Search.wire();wireKeys();
const opening=SM.parseRoute(location.hash);
const startCh=(opening&&opening.ch)||1,startTab=(opening&&opening.tab)||'learn';
load(startCh,{tab:startTab,silent:true});
if(opening&&opening.q!=null)openPastQuestion(opening.q);
// Replace, not push: the entry that was never addressable should not be a Back step.
writeRoute({tab:startTab,ch:startCh,q:opening?opening.q:null},true);
window.addEventListener('hashchange',onHash);
setRail(localStorage.getItem(NS+'-rail')==='1',false);
ready=true;
window.APP={load,ans:Quiz.answer,tpq:Past.toggle,markDone,pastFilter:Past.setFilter,gotoResult:Search.gotoResult,page:openPage,
  exhibit:openExhibit,closeExhibit,
  exportProgress:Progress.exportProgress,importProgress:Progress.importProgress,resetProgress:Progress.resetProgress,
  startExam:Exam&&Exam.start,revealExam:Exam&&Exam.reveal,markExam:Exam&&Exam.mark,submitExam:Exam&&Exam.submit,clearExam:Exam&&Exam.clear,
  sections:setAllSections,pastAll:Past.all,pastAllVariants:Past.allVariants,tVariants:Past.toggleVariants,tVariantAnswer:Past.toggleVariantAnswer,setRail};
})();

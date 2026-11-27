// Shadow-root styles. Every color/size reads a public --mlp-* variable first (inherited from the
// host page through the shadow boundary), then a scheme default. Private variables start with --_.
// Logical properties only, so RTL hosts get a mirrored layout for free.
export const CSS = `:host{display:contents}
.w{display:contents;--_s:var(--mlp-surface,#fff);--_t:var(--mlp-text,#1b1c20);--_m:var(--mlp-muted,#5f616a);--_bd:var(--mlp-border,rgba(22,24,32,.14));--_ok:var(--mlp-success,#1a7f37);--_er:var(--mlp-danger,#b42318);--_a:var(--mlp-accent,var(--_ha,var(--_t)));--_ac:var(--mlp-accent-contrast,var(--_hac,var(--_s)));--_r:var(--mlp-radius,12px);--_r2:calc(var(--_r)*.67);--_u:var(--mlp-space,4px);--_o:var(--mlp-offset,16px);--_sh:var(--mlp-shadow,0 1px 2px rgba(16,18,24,.06),0 12px 32px -6px rgba(16,18,24,.18));--_soft:color-mix(in srgb,var(--_t) 6%,var(--_s));color-scheme:light}
.w[data-scheme=dark]{--_s:var(--mlp-surface,#1c1d21);--_t:var(--mlp-text,#ececef);--_m:var(--mlp-muted,#a3a4ad);--_bd:var(--mlp-border,rgba(255,255,255,.14));--_ok:var(--mlp-success,#4ac26b);--_er:var(--mlp-danger,#ff8b7e);--_sh:var(--mlp-shadow,0 1px 2px rgba(0,0,0,.4),0 16px 40px -8px rgba(0,0,0,.65));--_soft:color-mix(in srgb,var(--_t) 9%,var(--_s));color-scheme:dark}
.t,.d{font-family:var(--mlp-font-family);font-size:var(--mlp-font-size,14px);font-weight:400;font-style:normal;line-height:1.45;letter-spacing:normal;text-transform:none;text-align:start;white-space:normal;color:var(--_t);box-sizing:border-box;z-index:var(--mlp-z-index,2147483000);position:fixed;border:1px solid var(--_bd);background:var(--_s);box-shadow:var(--_sh)}
*{box-sizing:inherit}
button,input,textarea{font:inherit;color:inherit;margin:0}
button{cursor:pointer;background:none;border:1px solid var(--_bd);border-radius:var(--_r2)}
[hidden]{display:none!important}
:focus{outline:none}
:focus-visible{outline:2px solid var(--_a);outline-offset:2px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
svg{flex:none;width:16px;height:16px}
.t{inset-block:auto var(--_o);inset-inline:auto var(--_o);display:inline-flex;align-items:center;gap:calc(var(--_u)*2);height:40px;padding-block:0;padding-inline:calc(var(--_u)*3.5) calc(var(--_u)*4.5);border-radius:99px;font-weight:500;transition:transform .15s}
.t:hover{transform:translateY(-1px)}
.t.c{width:44px;height:44px;padding:0;justify-content:center}
.d{margin:0;padding:0;width:min(384px,calc(100vw - 2*var(--_o)));max-width:none;max-height:calc(100dvh - 2*var(--_o) - 56px);overflow:auto;inset-block:auto calc(var(--_o) + 52px);inset-inline:auto var(--_o);border-radius:var(--_r)}
[data-pos^=t] .t{inset-block:var(--_o) auto}
[data-pos^=t] .d{inset-block:calc(var(--_o) + 52px) auto}
[data-pos$=s] :is(.t,.d){inset-inline:var(--_o) auto}
[data-nt] .d{inset-block:auto var(--_o)}
[data-nt][data-pos^=t] .d{inset-block:var(--_o) auto}
.d[open]{animation:in .18s cubic-bezier(.2,.8,.2,1)}
@keyframes in{from{opacity:0;transform:translateY(6px) scale(.985)}}
.p,.v{display:flex;flex-direction:column;gap:calc(var(--_u)*3)}
.p{padding:calc(var(--_u)*4)}
.h{display:flex;align-items:center;justify-content:space-between;margin-block-end:calc(var(--_u)*-1)}
h2,.q{margin:0;font-size:1.08em;font-weight:600;letter-spacing:-.01em}
.x{display:grid;place-items:center;width:30px;height:30px;margin-inline-end:-6px;border:0;color:var(--_m)}
:is(.x,.k button,.o button):hover{background:var(--_soft);color:var(--_t)}
.k{display:flex;flex-wrap:wrap;gap:calc(var(--_u)*1.25)}
.k button{height:28px;padding:0 calc(var(--_u)*2.25);border-radius:99px;font-size:.93em}
.k [aria-pressed=true],.k [aria-pressed=true]:hover{background:var(--_a);border-color:var(--_a);color:var(--_ac)}
textarea,.in{display:block;width:100%;padding:calc(var(--_u)*2.5) calc(var(--_u)*3);border:1px solid var(--_bd);border-radius:var(--_r2);background:none;line-height:1.45}
textarea{min-height:108px;max-height:40vh;resize:vertical}
.in{height:38px;padding-block:0}
:is(textarea,.in):focus{outline:2px solid var(--_a);outline-offset:-1px;border-color:transparent}
::placeholder{color:var(--_m);opacity:1}
[aria-invalid=true]{border-color:var(--_er)}
.er{margin:0;color:var(--_er);font-size:.93em}
.er:empty{display:none}
.f{display:flex;align-items:center;gap:calc(var(--_u)*3)}
.s{height:36px;padding:0 calc(var(--_u)*4);margin-inline-start:auto;border-color:transparent;background:var(--_a);color:var(--_ac);font-weight:500}
.s:hover{opacity:.88}
[aria-disabled=true]{opacity:.55;cursor:default}
.ok{display:flex;align-items:center;gap:calc(var(--_u)*1.5);margin:0;color:var(--_m);font-size:.93em}
.ok svg{color:var(--_ok)}
.result-body{block-size:calc(12em + var(--_u)*10);overflow:auto;scrollbar-gutter:stable;padding:2px;margin:-2px;overflow-wrap:anywhere}
.result-body>.v{min-block-size:100%}
.pending{display:flex;align-items:center;gap:calc(var(--_u)*2);min-block-size:1.45em}
.spinner{flex:none;width:1em;height:1em;border:2px solid var(--_bd);border-block-start-color:currentColor;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(1turn)}}
.question-remainder{visibility:hidden}
.o{display:grid;gap:calc(var(--_u)*1.5)}
.o button{min-height:40px;padding:calc(var(--_u)*2) calc(var(--_u)*3);text-align:start}
.ta{display:flex;gap:calc(var(--_u)*2)}
.ta .in{flex:1;min-width:0}
.ta .s{margin:0}
.sk{align-self:flex-start;padding:2px 0;border:0;color:var(--_m);text-decoration:underline;text-underline-offset:3px;font-size:.93em}
.sk:hover{color:var(--_t)}
.dn{align-items:flex-start;gap:calc(var(--_u)*1.5)}
.dn p{margin:0}
.m{color:var(--_m)}
.dn .s{margin-block-start:auto}
.lg{margin:calc(var(--_u)*-1) 0 0;color:var(--_m);font-size:.8em;line-height:1.4}
.lg a{color:inherit;text-decoration:underline;text-underline-offset:2px}
.lg a:hover{color:var(--_t)}
.b{margin:calc(var(--_u)*.5) calc(var(--_u)*-4) calc(var(--_u)*-1.5);padding:calc(var(--_u)*2.5) calc(var(--_u)*4) 0;border-block-start:1px solid var(--_bd);color:var(--_m);font-size:.8em;text-align:center}
.b a{color:inherit;text-decoration:none}
.b a:hover{text-decoration:underline}
@media (max-width:520px){.d{inset:auto 0 0;width:100%;max-height:88dvh;border-width:1px 0 0;border-radius:var(--_r) var(--_r) 0 0}.d[open]{animation:up .24s}.p{padding-block-end:calc(var(--_u)*4 + env(safe-area-inset-bottom,0px))}.k button{height:32px}textarea,.in{font-size:16px}}
@keyframes up{from{transform:translateY(40%);opacity:0}}
@media (prefers-reduced-motion:reduce){.d[open],.spinner{animation:none}.t{transition:none;transform:none!important}}
@media (forced-colors:active){.k [aria-pressed=true]{outline:2px solid}}`;

// Public campaign page (replaces the Google Form). Copy from "Landing page descriptions.pdf".
// Layout: gradient hero · about + 3 illustrated pillars · reward ladder · steps bento · platforms · registration · FAQ · T&C.
// Reward amounts come from CAMPAIGN_SETTINGS › Reward Milestones, so the page always matches what is paid.
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Clapperboard, Eye, IndianRupee, LayoutDashboard, Send, Trophy, Upload, Zap } from 'lucide-react'
import { PLATFORM_LABEL, api, compact, date, inr, num, setToken, useApi } from './lib'
import { Async } from './ui'

type Milestone = { views: number; amount: number }

const STEPS: [string, string, ReactNode][] = [
  ['Create', 'Come up with an interesting idea and create an engaging video around Zypp and the gig economy.', <Clapperboard size={18} />],
  ['Upload', 'Post your video on Instagram, YouTube or Facebook.', <Upload size={18} />],
  ['Submit', 'Submit your video link through the campaign submission form for review.', <Send size={18} />],
  ['Get rewarded', 'Achieve the specified view milestones and earn the corresponding cash rewards.', <Trophy size={18} />],
]

const FAQS = (ms: Milestone[]) => [
  ['Who can participate in this campaign?', 'Zypp Team Leaders can participate in the campaign by creating and submitting engaging videos around Zypp and the gig economy.'],
  ['Which platforms are eligible?', 'Videos uploaded on Instagram, YouTube and Facebook will be considered.'],
  ['Can I submit multiple videos?', 'Yes! You can create, upload and submit multiple videos simultaneously across the eligible platforms and can submit one video across multiple platforms.'],
  ['Will all my submitted videos be eligible for rewards?', 'No. Only one video per platform will be considered for rewards. The first video on each platform to achieve any one of the specified milestones will be eligible.'],
  ['How will my video be reviewed?', 'Each submitted video will be reviewed within 7 days of submission to verify its eligibility and performance against the campaign milestones.'],
  ['Can I earn rewards for achieving multiple milestones with the same video?', 'No. Rewards will be calculated based on the highest milestone achieved by your eligible video and will not be cumulative.'],
  ['Can I earn rewards on multiple platforms?', 'Yes. The one-video-per-platform rule applies independently to Instagram, YouTube and Facebook.'],
  ['How much can I earn?', ms.length ? `You can earn rewards ranging from ${inr(ms[0].amount)} to ${inr(ms[ms.length - 1].amount)} depending on the highest view milestone achieved by your eligible video.` : 'Rewards depend on the highest view milestone achieved by your eligible video.'],
]


const Head = ({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) => (
  <div className="lx-head"><span className="lx-eyebrow">{eyebrow}</span><h2>{title}</h2>{children && <p>{children}</p>}</div>
)

// ---------- Custom graphics (inline SVG, brand greens) ----------
const ArtCreate = () => (
  <svg viewBox="0 0 160 110" className="lx-art" aria-hidden="true">
    <rect x="58" y="8" width="44" height="86" rx="9" fill="#fff" stroke="#BFE9CF" strokeWidth="2" />
    <rect x="64" y="18" width="32" height="56" rx="4" fill="#E6F8EE" />
    <polygon points="76,38 76,56 90,47" fill="#008F3D" />
    <circle cx="80" cy="84" r="4" fill="#00C853" />
    <circle cx="36" cy="40" r="10" fill="#fff" stroke="#BFE9CF" strokeDasharray="3 3" />
    <circle cx="124" cy="66" r="12" fill="#fff" stroke="#BFE9CF" strokeDasharray="3 3" />
    <circle cx="124" cy="66" r="4" fill="#F04438" />
    <path d="M46 40 H58 M102 66 H112" stroke="#BFE9CF" strokeDasharray="3 3" />
  </svg>
)
const ArtShare = () => (
  <svg viewBox="0 0 160 110" className="lx-art" aria-hidden="true">
    <circle cx="80" cy="55" r="40" fill="none" stroke="#BFE9CF" strokeDasharray="4 4" />
    <circle cx="80" cy="55" r="18" fill="#008F3D" />
    <path d="M83 44 L74 57 H81 L77 67 L87 52 H80 Z" fill="#fff" />
    {[['IG', 80, 15], ['YT', 117, 70], ['FB', 43, 70]].map(([t, x, y]) => (
      <g key={t as string}><circle cx={x as number} cy={y as number} r="11" fill="#fff" stroke="#00C853" /><text x={x as number} y={(y as number) + 3.5} textAnchor="middle" fontSize="9" fontWeight="700" fill="#008F3D">{t}</text></g>
    ))}
  </svg>
)
const ArtEarn = () => (
  <svg viewBox="0 0 160 110" className="lx-art" aria-hidden="true">
    {[0, 1, 2, 3].map((i) => <rect key={i} x={30 + i * 26} y={86 - (i + 1) * 17} width="18" height={(i + 1) * 17} rx="4" fill={i === 3 ? '#008F3D' : '#BFE9CF'} />)}
    <path d="M30 80 L56 64 L82 50 L108 28" stroke="#00C853" strokeWidth="2" fill="none" />
    <circle cx="128" cy="26" r="15" fill="#fff" stroke="#00C853" strokeWidth="2" />
    <text x="128" y="31" textAnchor="middle" fontSize="14" fontWeight="700" fill="#008F3D">₹</text>
    <line x1="24" y1="88" x2="138" y2="88" stroke="#D5EADF" />
  </svg>
)
const Orbit = () => (
  <svg viewBox="0 0 400 400" className="lx-orbit" aria-hidden="true">
    <circle cx="200" cy="200" r="190" fill="none" stroke="rgba(255,255,255,.35)" strokeDasharray="5 7" />
    <circle cx="200" cy="200" r="130" fill="none" stroke="rgba(255,255,255,.25)" />
    <circle cx="390" cy="200" r="7" fill="#fff" /><circle cx="70" cy="200" r="5" fill="#fff" opacity=".7" />
  </svg>
)

// ---------- Content blocks ----------
function Terms({ ms }: { ms: Milestone[] }) {
  const slabs = ms.map((m) => `${num(m.views)}+ views – ${inr(m.amount)}`).join('; ')
  return (
    <ol className="lx-terms">
      <li><strong>Video Review:</strong> Each submitted video will be reviewed within 7 days of submission to verify its eligibility and performance against the campaign milestones, which includes {slabs}.</li>
      <li><strong>One Video per Platform:</strong> Only one video per platform (Instagram, YouTube and Facebook) will be considered for rewards. The first video on each platform to achieve any one of the specified milestones will be eligible for the corresponding reward. Subsequent videos on the same platform will not be considered for rewards.</li>
      <li><strong>Multiple Video Submissions:</strong> Team Leaders are free to upload and submit multiple videos simultaneously across the eligible platforms. However, reward eligibility will remain subject to the one-video-per-platform rule mentioned above.</li>
      <li><strong>Reward Calculation:</strong> Rewards will be calculated based on the highest milestone achieved by the eligible video and will not be cumulative across multiple milestone slabs.</li>
      <li><strong>Reward Eligibility:</strong> All rewards are subject to verification of the submitted video and its achieved view count by the Zypp campaign team.</li>
    </ol>
  )
}

function Hero({ m, ms }: { m: any; ms: Milestone[] }) {
  const top = ms[ms.length - 1]
  return (
    <section className="lx-hero lx-split" id="submit">
      <Orbit />
      <div className="lx-hero-copy">
        <span className={`lx-chip ${m.open ? 'open' : ''}`}>{m.open ? '● Submissions open' : 'Submissions closed'}</span>
        <h1>Creators League<br /><span>Team Leader Edition</span></h1>
        <p className="lx-tag">Create, Influence, Earn</p>
        {(m.campaignStart || m.campaignEnd) && <p className="lx-dates">{date(m.campaignStart)} – {date(m.campaignEnd)}</p>}
        <div className="lx-stats" aria-hidden="true">
          <div className="lx-stat"><span className="lx-ic"><Eye size={14} /></span><div><small>Starts at</small><strong>{ms[0] ? `${compact(ms[0].views)}+ views` : 'view milestones'}</strong></div></div>
          <div className="lx-stat"><span className="lx-ic ok"><CheckCircle2 size={14} /></span><div><small>Review</small><strong>Within 7 days</strong></div></div>
          {top && <div className="lx-stat"><span className="lx-ic"><IndianRupee size={14} /></span><div><small>Win up to</small><strong>{inr(top.amount)}</strong></div></div>}
        </div>
        <div className="lx-hero-about">
          <span className="lx-eyebrow light">About the campaign</span>
          <h2>Create. Influence. Go Viral. Get Rewarded.</h2>
          <p className="lx-strong">Your creativity. Your content. Your rewards!</p>
          <p>Are you a Zypp Team Leader with a creative spark? Here's your chance to turn your ideas into engaging videos, inspire people and put the spotlight on India's growing gig economy.</p>
          <p>Create exciting content around Zypp, its riders and the world of gig work. Share your videos on Instagram, YouTube or Facebook, reach exciting view milestones and win cash rewards for your content performance.</p>
        </div>
      </div>
      <div className="lx-box lx-formbox"><h3>TL Registration</h3><p className="muted sm">Submit your video link for review</p><EntryForm meta={m} /></div>
    </section>
  )
}

export function Landing() {
  const meta = useApi<any>('/public/meta')
  const [openFaq, setOpenFaq] = useState(0)
  return (
    <div className="lx">
      <header className="lx-top">
        <div className="brand"><span className="logo"><Zap size={16} /></span><div><strong>Zypp Creator League</strong><span className="muted sm">Zypp Electric</span></div></div>
        <Link to="/login" className="btn sm"><LayoutDashboard size={14} /> My dashboard</Link>
      </header>
      <Async q={meta}>{(m) => {
        const ms: Milestone[] = [...(m.milestones ?? [])].sort((a, b) => a.views - b.views)
        return (
          <main className="lx-main">
            <Hero m={m} ms={ms} />

            <section className="lx-sec">
              <div className="lx-pillars">
                <div className="lx-pillar"><ArtCreate /><h3>You create</h3><p>Turn your ideas into videos around Zypp, its riders and gig work.</p></div>
                <div className="lx-pillar"><ArtShare /><h3>You share</h3><p>Post on Instagram, YouTube or Facebook, wherever your audience is.</p></div>
                <div className="lx-pillar"><ArtEarn /><h3>Your views bring rewards</h3><p>Reach view milestones and win cash rewards for your content.</p></div>
              </div>
            </section>

            <section className="lx-sec">
              <Head eyebrow="Rewards" title="Your Views. Your Rewards.">Every milestone brings you closer to an exciting reward. Create content that connects with people and watch your creativity turn into cash rewards.</Head>
              <div className="lx-ladder">
                {ms.map((x, i) => (
                  <div key={x.views} className={`lx-rung ${i === ms.length - 1 ? 'peak' : ''}`}>
                    <div className="lx-bar"><i style={{ height: `${30 + (i * 70) / Math.max(1, ms.length - 1)}%` }} /></div>
                    <small>Achieve</small><strong>{num(x.views)}+</strong><span>views</span>
                    <em>{inr(x.amount)}</em>
                  </div>
                ))}
              </div>
              <div className="lx-note"><strong>One video. Multiple milestones. Bigger rewards!</strong> Your reward will be based on the highest milestone achieved by your eligible video.</div>
            </section>

            <section className="lx-sec">
              <Head eyebrow="How to participate" title="Getting started is simple">Just follow these steps:</Head>
              <div className="lx-bento">
                {STEPS.map(([t, d, ic], i) => (
                  <div key={t} className={`lx-step s${i + 1}`}>
                    <span className="lx-num">STEP 0{i + 1}</span>
                    <span className="lx-ic big">{ic}</span>
                    <h3>{t}</h3><p>{d}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="lx-sec">
              <Head eyebrow="Platforms" title="Three Platforms. More Opportunities.">Showcase your creativity wherever your audience is!</Head>
              <div className="lx-plats">{['Instagram', 'YouTube', 'Facebook'].map((p) => <span key={p} className={`lx-plat ${p.toLowerCase()}`}>{p}</span>)}</div>
              <p className="lx-center muted">You can upload and submit multiple videos simultaneously across all three platforms. However, only the first eligible video to achieve a specified milestone on each platform will qualify for rewards.</p>
            </section>

            <section className="lx-sec">
              <Head eyebrow="FAQ" title="Frequently Asked Questions" />
              <div className="lx-faq">
                {FAQS(ms).map(([q, a], i) => (
                  <div key={q} className={`lx-q ${openFaq === i ? 'open' : ''}`}>
                    <button onClick={() => setOpenFaq(openFaq === i ? -1 : i)} aria-expanded={openFaq === i}><span>{String(i + 1).padStart(2, '0')}</span>{q}<b>+</b></button>
                    {openFaq === i && <p>{a}</p>}
                  </div>
                ))}
              </div>
            </section>

            <section className="lx-sec" id="terms">
              <Head eyebrow={m.termsVersion ? `Version ${m.termsVersion}` : 'Terms'} title="Terms & Conditions" />
              <div className="lx-box"><Terms ms={ms} /></div>
            </section>
          </main>
        )
      }}</Async>
    </div>
  )
}

const EMPTY = { name: '', employeeId: '', email: '', city: '', platform: '', url: '', terms: false, website: '' }

function EntryForm({ meta }: { meta: any }) {
  const [f, setF] = useState({ ...EMPTY, platform: meta.platforms[0] ?? '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ submissionId?: string; newParticipant?: boolean; name?: string; token?: string } | null>(null)
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  if (!meta.open) return <p className="muted">Video submissions are closed for this campaign right now.</p>
  if (!meta.cities.length) return <p className="err-text">The campaign team hasn't added the city list yet. Please check back soon.</p>

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try { setDone(await api('/public/register', { method: 'POST', body: f })) } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  // The submit response carries a TL session, so the dashboard opens already signed in.
  const openDashboard = () => { if (done?.token) setToken(done.token); window.location.assign(done?.token ? '/me' : '/login') }
  return (
    <>
    {done && (
      <div className="modal-scrim">
        <div className="card modal lp-done" role="dialog" aria-modal="true" aria-labelledby="done-title">
          <CheckCircle2 size={32} className="green" />
          <h3 id="done-title">Thanks{done.name ? `, ${done.name.split(' ')[0]}` : ''}! Your video is submitted.</h3>
          {done.submissionId && <p>Submission ID <strong>{done.submissionId}</strong>{done.newParticipant ? ' · you are now registered for the campaign.' : '.'}</p>}
          <p className="muted sm">The campaign team will verify your views. Only approved, verified views count towards your rank.</p>
          <button className="btn primary" autoFocus onClick={openDashboard}><LayoutDashboard size={15} /> Open my dashboard</button>
        </div>
      </div>
    )}
    <form className="form" onSubmit={submit}>
      <label>Name<input value={f.name} onChange={set('name')} autoComplete="name" maxLength={80} required /></label>
      <label>Employee ID<input value={f.employeeId} onChange={set('employeeId')} maxLength={30} required /></label>
      <label>Email ID<input type="email" value={f.email} onChange={set('email')} autoComplete="email" maxLength={120} required /></label>
      <label>City<select value={f.city} onChange={set('city')} required><option value="">Choose your city</option>{meta.cities.map((c: string) => <option key={c}>{c}</option>)}</select></label>
      <label>Content platform<select value={f.platform} onChange={set('platform')} required>{meta.platforms.map((p: string) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}</select></label>
      <label>Content link<input type="url" value={f.url} onChange={set('url')} placeholder={f.platform === 'youtube' ? 'https://www.youtube.com/shorts/…' : f.platform === 'facebook' ? 'https://www.facebook.com/reel/…' : 'https://www.instagram.com/reel/…'} maxLength={500} required /></label>
      {/* Honeypot: hidden from people and screen readers; bots that fill it are ignored by the server. */}
      <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={set('website')} name="website" />
      <label className="check lx-check"><input type="checkbox" checked={f.terms} onChange={(e) => setF({ ...f, terms: e.target.checked })} required /> I accept the <a href="#terms">Terms &amp; Conditions</a></label>
      <p className="muted sm">Already took part? Use the same Employee ID and email ID to add another video.</p>
      {err && <p className="err-text" role="alert">{err}</p>}
      <button className="btn primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit video'}</button>
    </form>
    </>
  )
}

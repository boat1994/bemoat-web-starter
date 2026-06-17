import Link from 'next/link'

import { homepageCtas } from '@/content/cta'
import { homepageHero, pricingNote, problemSymptoms, processSteps } from '@/content/homepage'
import { proofItems } from '@/content/proof'
import { growthPathServices, primaryService } from '@/content/services'

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <p className="eyebrow">{homepageHero.eyebrow}</p>
        <h1>{homepageHero.title}</h1>
        <p className="lead">{homepageHero.lead}</p>
        <div className="actions">
          <Link className="button primary" href={homepageCtas.diagnostic.href}>
            {homepageCtas.diagnostic.label}
          </Link>
          <Link className="button" href={homepageCtas.cmsWebsite.href}>
            {homepageCtas.cmsWebsite.label}
          </Link>
        </div>
      </section>

      <section className="section">
        <div className="sectionHeader">
          <p className="eyebrow">The problem</p>
          <h2>When business content changes faster than the website</h2>
          <p className="muted">
            Owner-led businesses feel this when updates pile up and the public site stops reflecting
            how the business actually works today.
          </p>
        </div>
        <ul className="symptomList">
          {problemSymptoms.map((symptom) => (
            <li key={symptom}>{symptom}</li>
          ))}
        </ul>
      </section>

      <section className="section">
        <div className="sectionHeader">
          <p className="eyebrow">Primary offer</p>
          <h2>{primaryService.name}</h2>
          <p className="lead">{primaryService.summary}</p>
        </div>
        <article className="card servicePrimary">
          <ul className="deliverableList">
            {primaryService.deliverables.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {primaryService.inquiryQuestion ? (
            <p className="muted">{primaryService.inquiryQuestion}</p>
          ) : null}
        </article>
        <p className="muted pricingNote">{pricingNote}</p>
      </section>

      <section className="section">
        <div className="sectionHeader">
          <p className="eyebrow">Growth path</p>
          <h2>After the CMS foundation — or when operations get messy</h2>
        </div>
        <div className="grid">
          {growthPathServices.map((service) => (
            <article className="card serviceSecondary" key={service.id}>
              <p className="tag">{service.priority === 'secondary' ? 'Secondary path' : 'Later lane'}</p>
              <h3>{service.name}</h3>
              <p>{service.summary}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="sectionHeader">
          <p className="eyebrow">Proof</p>
          <h2>Work preview</h2>
        </div>
        {proofItems.map((item) => (
          <article className="card proofCard" key={item.id}>
            <p className="tag">{item.label}</p>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
            {item.href ? (
              <Link className="button" href={item.href} rel="noopener noreferrer" target="_blank">
                View live site
              </Link>
            ) : null}
          </article>
        ))}
      </section>

      <section className="section">
        <div className="sectionHeader">
          <p className="eyebrow">Process</p>
          <h2>From diagnostic to launch</h2>
        </div>
        <ol className="processList">
          {processSteps.map((step, index) => (
            <li key={step.title}>
              <span className="processStep">{index + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p className="muted">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="section finalCta">
        <h2>Start with what changes most often in your business</h2>
        <p className="lead">
          Tell us what your team updates today — or say directly that you need a CMS-backed website
          they can maintain.
        </p>
        <div className="actions">
          <Link className="button primary" href={homepageCtas.diagnostic.href}>
            {homepageCtas.diagnostic.label}
          </Link>
          <Link className="button" href={homepageCtas.cmsWebsite.href}>
            {homepageCtas.cmsWebsite.label}
          </Link>
        </div>
      </section>
    </main>
  )
}

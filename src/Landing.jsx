import Dither from './components/Dither';
import DottedText from './components/DottedText';
import Wave from './components/Wave';
import Problem from './components/Problem';
import Compare from './components/Compare';
import CatchGrid from './components/CatchGrid';
import Faq from './components/Faq';
import Footer from './components/Footer';
import Logo from './components/Logo';
import usePrefersReducedMotion from './hooks/usePrefersReducedMotion';

const PAPER = [0.969, 0.969, 0.961];
const GUTTER_BLUE = [0.2, 0.4, 0.96];

export default function Landing({ onGetStarted }) {
  const reduceMotion = usePrefersReducedMotion();

  const seeItInAction = () => {
    document
      .querySelector('.cmp-section')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="page">
      <div className="dither-gutters" aria-hidden="true">
        <Dither
          waveColor={GUTTER_BLUE}
          backgroundColor={PAPER}
          waveSpeed={0.045}
          waveFrequency={2.6}
          waveAmplitude={0.55}
          colorNum={4}
          pixelSize={2}
          disableAnimation={reduceMotion}
          enableMouseInteraction={false}
        />
      </div>

      <div className="frame">
        <div className="screen">
          <header className="nav">
            <Logo />
            <nav className="nav-links" aria-label="Primary">
              <a href="#product">Product</a>
              <a href="#how">How it works</a>
              <a href="#pricing">Pricing</a>
              <a href="#docs">Docs</a>
            </nav>
            <div className="nav-actions">
              <button className="link-signin" type="button" onClick={onGetStarted}>
                Sign in
              </button>
              <button className="btn btn-primary" type="button" onClick={onGetStarted}>
                Get started
              </button>
            </div>
          </header>

          <main className="hero">
            <h1 className="headline">
              The Humanizer{' '}
              <DottedText text="for" color="#2f5fe6" reduceMotion={reduceMotion} />{' '}
              <DottedText text="Websites" color="#2f5fe6" reduceMotion={reduceMotion} />
            </h1>

            <p className="subhead">
              Thousands of AI tells, found and scrubbed from every page
              <br className="subhead-break" /> you publish, in a single
              integration.
            </p>

            <div className="cta-row">
              <button className="btn btn-primary btn-lg" type="button" onClick={onGetStarted}>
                Get started
              </button>
              <button className="btn btn-ghost btn-lg" type="button" onClick={seeItInAction}>
                See it in action
              </button>
            </div>
          </main>

          <Wave reduceMotion={reduceMotion} />
        </div>

        <Problem reduceMotion={reduceMotion} />
        <Compare />
        <CatchGrid reduceMotion={reduceMotion} />
        <Faq />
        <Footer />
      </div>
    </div>
  );
}

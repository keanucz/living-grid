export { default as Intro } from './Intro.jsx'
// For the #debug page (#231): play the intro again, whatever lg-intro-seen says.
export const replayIntro = () => dispatchEvent(new Event('lg-intro'))

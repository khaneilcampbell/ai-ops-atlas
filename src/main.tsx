import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { render } from 'preact';
import { App } from './app';
import { applyTheme, watchSystemTheme } from './theme';

applyTheme();
watchSystemTheme();
render(<App />, document.getElementById('app')!);

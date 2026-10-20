import { createApp } from 'vue';
import SessionRoot from './components/SessionRoot.vue';
import { createAppRouter } from './router';
import { createApplicationSession } from './session/appSession';
import { provideSessionController } from './session/injection';
import './assets/main.css';

const session = createApplicationSession();
const router = createAppRouter(session);
const app = createApp(SessionRoot);
provideSessionController(app, session);
app.use(router).mount('#app');

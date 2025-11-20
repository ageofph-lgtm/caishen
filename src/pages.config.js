import Dashboard from './pages/Dashboard';
import Generator from './pages/Generator';
import History from './pages/History';
import Analysis from './pages/Analysis';
import AIChat from './pages/AIChat';
import SuggestionsHistory from './pages/SuggestionsHistory';


export const PAGES = {
    "Dashboard": Dashboard,
    "Generator": Generator,
    "History": History,
    "Analysis": Analysis,
    "AIChat": AIChat,
    "SuggestionsHistory": SuggestionsHistory,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
};
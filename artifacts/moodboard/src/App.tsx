import { Switch, Route } from "wouter";
import { AuthProvider } from "@/hooks/useAuth";
import { RequireAuth } from "@/components/RequireAuth";
import Login from "@/pages/login";
import Signup from "@/pages/signup";
import Moodboard from "@/pages/moodboard";

function App() {
  return (
    <AuthProvider>
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/signup" component={Signup} />
        <Route>
          <RequireAuth>
            <Moodboard />
          </RequireAuth>
        </Route>
      </Switch>
    </AuthProvider>
  );
}

export default App;

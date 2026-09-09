import { useState } from "react";
import { api, type Admin } from "../../lib/api";
import "./admin.css";

export default function AdminLogin({
  onAuthenticated,
}: {
  onAuthenticated: (admin: Admin) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const { admin } = await api.admin.login(email, password);
      onAuthenticated(admin);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not sign in");
      setSubmitting(false);
    }
  }

  return (
    <main className="admin admin--centered">
      <form className="admin__login" onSubmit={handleSubmit}>
        <h1 className="admin__title">studio</h1>

        <label className="admin__field">
          <span>email</span>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="admin__field">
          <span>password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error ? (
          <p className="admin__error" role="alert">
            {error}
          </p>
        ) : null}

        <button className="admin__primary" type="submit" disabled={submitting}>
          {submitting ? "signing in…" : "sign in"}
        </button>
      </form>
    </main>
  );
}

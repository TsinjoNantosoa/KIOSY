import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** Frontière d'erreur globale : message compréhensible, sans détail technique ni donnée sensible. */
export class ErrorBoundary extends Component<{ children: ReactNode; inline?: boolean }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Point d'extension : remonter vers l'outil de supervision après masquage des données sensibles.
    console.error("Erreur d'interface", error.name, info.componentStack?.split("\n")[1]?.trim());
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className={this.props.inline ? "py-12 text-center" : "container max-w-xl py-16 text-center"}>
        <h1 className="font-serif text-2xl font-semibold">Cet écran n'a pas pu s'afficher</h1>
        <p className="mt-3 text-ink-muted">Aucune action n'a été effectuée. Vous pouvez recharger la page ou revenir à l'accueil.</p>
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" className="min-h-11 rounded-md bg-brand px-4 font-medium text-white" onClick={() => window.location.reload()}>
            Recharger
          </button>
          <a className="inline-flex min-h-11 items-center rounded-md border border-line px-4 font-medium" href="/">
            Accueil
          </a>
        </div>
      </div>
    );
  }
}

import { useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export default function App() {
    const [health, setHealth] = useState(null);
    const [error, setError] = useState("");
    const [isChecking, setIsChecking] = useState(false);

    function checkHealth() {
        setIsChecking(true);
        setError("");

        return fetch(`${API_BASE_URL}/health`)
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`Health check failed with status ${response.status}`);
                }
                return response.json();
            })
            .then((data) => {
                setHealth(data);
                setError("");
            })
            .catch((healthError) => {
                setHealth(null);
                setError(healthError.message);
            })
            .finally(() => {
                setIsChecking(false);
            });
    }

    return (
        <main className="page-shell">
            <section className="status-panel" aria-labelledby="page-title">
                <p className="eyebrow">TTB Label Verification</p>
                <h1 id="page-title">System Health</h1>
                <p className="intro">
                    This deployment is ready when the backend health response appears
                    below.
                </p>

                <button className="health-button" type="button" onClick={checkHealth} disabled={isChecking}>
                    {isChecking ? "Checking..." : "Check Backend"}
                </button>

                <div className={error ? "status-box status-error" : "status-box"}>
                    <span className="status-label">
                        {error ? "Backend connection failed" : health ? "Backend connected" : "Ready to check"}
                    </span>
                    <pre>{error || JSON.stringify(health, null, 2) || "Click the button to check backend health."}</pre>
                </div>
            </section>
        </main>
    );
}

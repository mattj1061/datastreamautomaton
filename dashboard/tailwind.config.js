/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                darkNavy: '#0B1121',
                neonCyan: '#00f2ff',
                deptResearch: '#9333ea', // purple
                deptDev: '#3b82f6', // blue
                deptCreative: '#ec4899', // pink
                panelBg: '#12192b',
                panelBorder: '#1f2937'
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace'],
            }
        },
    },
    plugins: [],
}

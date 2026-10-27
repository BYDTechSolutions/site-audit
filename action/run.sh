#!/usr/bin/env bash
# The GitHub Action's one step (see action.yml). Inputs arrive as INPUT_* env
# vars, never pasted into the script, so their text cannot run as shell code.
# One audit writes every format: text for the log, Markdown for the job
# summary, JSON for the outputs, and HTML when asked.
set -uo pipefail

fail() {
  echo "::error title=site-audit::$1"
  exit 2
}

command -v node >/dev/null 2>&1 || fail "Node.js 20 or newer is needed. Add actions/setup-node before this step."
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 20 ] || fail "Node.js 20 or newer is needed, found $(node -v). Add actions/setup-node with node-version: 22 before this step."

pkg="${INPUT_PACKAGE:-}"
if [ -z "$pkg" ]; then
  version=$(node -p 'require(process.argv[1]).version' "$GITHUB_ACTION_PATH/package.json")
  pkg="@bydtech/site-audit@$version"
fi

url="${INPUT_URL:-}"
[ -n "$url" ] || fail "url is required, for example: url: https://example.com or url: http://localhost:3000"
case "$url" in http://* | https://*) ;; *) url="https://$url" ;; esac

wait="${INPUT_WAIT:-60}"
[[ "$wait" =~ ^[0-9]+$ ]] || fail "wait must be a number of seconds, got \"$wait\"."
if [ "$wait" -gt 0 ]; then
  echo "Waiting up to ${wait}s for $url to answer..."
  deadline=$((SECONDS + wait))
  until curl -sk --max-time 10 "$url" > /dev/null; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      fail "$url did not answer within ${wait}s. If it is your own app, start it in an earlier step, in the background (for example: npm start &), or raise the wait input."
    fi
    sleep 2
  done
fi

out="${RUNNER_TEMP:-/tmp}/site-audit"
mkdir -p "$out"
rm -f "$out/report.txt" "$out/report.md" "$out/report.json"

args=("$url" --quiet --no-color -o "$out/report.txt" -o "$out/report.md" -o "$out/report.json")
[ -n "${INPUT_HTML_FILE:-}" ] && args+=(-o "$INPUT_HTML_FILE")
[ "${INPUT_DESKTOP:-false}" = true ] && args+=(--desktop)
[ -n "${INPUT_ONLY:-}" ] && args+=(--only "$INPUT_ONLY")
[ -n "${INPUT_MAX_LINKS:-}" ] && args+=(--max-links "$INPUT_MAX_LINKS")
fail_on="${INPUT_FAIL_ON-fix-now}"
case "$fail_on" in
  none | '') ;;
  fix-now | should-fix) args+=(--fail-on "$fail_on") ;;
  *) fail "fail-on must be fix-now, should-fix or none, got \"$fail_on\"." ;;
esac
if [ -n "${INPUT_ARGS:-}" ]; then
  read -r -a extra <<< "$INPUT_ARGS"
  args+=("${extra[@]}")
fi
if [ -n "${INPUT_PSI_KEY:-}" ]; then
  export PSI_API_KEY="$INPUT_PSI_KEY"
  echo "::add-mask::$INPUT_PSI_KEY"
elif [[ " ${INPUT_ARGS:-} " != *" --no-psi "* ]]; then
  echo "No psi-key given: PageSpeed Insights runs on Google's shared quota, which often has none left, so speed and Google's scores may be missing."
fi

echo "Running $pkg"
# On Windows runners, Git Bash rewrites arguments that start with / into
# Windows paths. The two variables turn that off for npx.
MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' npx --yes --package="$pkg" -- site-audit "${args[@]}"
code=$?

[ -f "$out/report.txt" ] || exit "$code"
echo
cat "$out/report.txt"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  if [ "$(wc -c < "$out/report.md")" -lt 1000000 ]; then
    cat "$out/report.md" >> "$GITHUB_STEP_SUMMARY"
  else
    echo "The site-audit report is too large for the job summary; it is in the log." >> "$GITHUB_STEP_SUMMARY"
  fi
fi

node -e '
const r = require(process.argv[1]);
const n = (p) => r.findings.filter((f) => f.priority === p).length;
const scores = {};
for (const s of r.data.speed ?? []) if (s.scores) scores[s.strategy] = s.scores;
console.log(`fix-now=${n("fix-now")}\nshould-fix=${n("should-fix")}\nnice-to-have=${n("nice-to-have")}\nscores=${JSON.stringify(scores)}`);
' "$out/report.json" >> "${GITHUB_OUTPUT:-/dev/null}"
{
  echo "report-json=$out/report.json"
  echo "report-md=$out/report.md"
  echo "html-file=${INPUT_HTML_FILE:-}"
} >> "${GITHUB_OUTPUT:-/dev/null}"

[ "$code" -eq 1 ] && echo "::error title=site-audit::Findings at fail-on $fail_on or above. The report is in the log and the job summary."
exit "$code"

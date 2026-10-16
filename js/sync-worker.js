'use strict';

var active = false;

self.onmessage = async function (event) {
    if (active) return;
    active = true;
    var input = event.data || {};
    var runtimeUrl = 'https://cdn.jsdelivr.net/pyodide/v' +
        encodeURIComponent(input.pyodideVersion) + '/full/';
    var pyodide;

    function report(type, payload) {
        var message = { type: type };
        if (payload && typeof payload === 'object') {
            Object.assign(message, payload);
        } else if (payload !== undefined) {
            message.message = payload;
        }
        self.postMessage(message);
    }

    try {
        report('progress', 'Loading the on-device sync engine…');
        importScripts(runtimeUrl + 'pyodide.js');
        pyodide = await loadPyodide({ indexURL: runtimeUrl });
        await pyodide.loadPackage('micropip');
        await pyodide.runPythonAsync(
            'import micropip\n' +
            'await micropip.install(["requests==2.32.3", "pyodide-http==0.2.2"])\n' +
            'import pyodide_http\n' +
            'pyodide_http.patch_all()\n'
        );

        report('progress', 'Fetching Intervals.icu data on this device…');
        var sourceUrl = new URL('../sync.py', self.location.href).toString();
        var sourceResponse = await fetch(sourceUrl, { cache: 'no-store' });
        if (!sourceResponse.ok) {
            throw new Error('Could not load the Section 11 sync engine (' + sourceResponse.status + ').');
        }
        var source = await sourceResponse.text();
        pyodide.FS.mkdirTree('/coach');
        pyodide.FS.chdir('/coach');
        pyodide.FS.writeFile('sync.py', source);
        var runnerInput = {
            athleteId: input.athleteId,
            intervalsKey: input.intervalsKey,
            days: Number(input.days) || 7,
            files: input.files || {}
        };
        pyodide.globals.set('SYNC_INPUT_JSON', JSON.stringify(runnerInput));
        await pyodide.runPythonAsync(
            'import contextlib, io, json, os, traceback\n' +
            'from pathlib import Path\n' +
            '_sync_input = json.loads(SYNC_INPUT_JSON)\n' +
            'for _name, _contents in _sync_input["files"].items():\n' +
            '    Path(_name).write_text(_contents, encoding="utf-8")\n' +
            '_captured_output = io.StringIO()\n' +
            '_sync_result = {}\n' +
            'try:\n' +
            '    with contextlib.redirect_stdout(_captured_output), contextlib.redirect_stderr(_captured_output):\n' +
            '        _namespace = {"__name__": "local_sync", "__file__": str(Path("sync.py").resolve())}\n' +
            '        exec(compile(Path("sync.py").read_text(encoding="utf-8"), "sync.py", "exec"), _namespace)\n' +
            '        _engine = _namespace["IntervalsSync"](_sync_input["athleteId"], _sync_input["intervalsKey"], None, None, debug=False, week_start_day=0)\n' +
            '        if _engine.should_generate_history():\n' +
            '            try:\n' +
            '                _history = _engine.generate_history()\n' +
            '                _engine.save_to_file(_history, "history.json")\n' +
            '            except Exception as _history_error:\n' +
            '                _engine._record_history_refresh_failure(_history_error)\n' +
            '        _data = _engine.collect_training_data(days_back=_sync_input["days"])\n' +
            '        if not isinstance(_data, dict):\n' +
            '            raise TypeError("The sync engine returned an invalid latest.json snapshot.")\n' +
            '        _engine.save_to_file(_data, "latest.json")\n' +
            '        if getattr(_engine, "_intervals_data", None) is not None:\n' +
            '            Path("intervals.json").write_text(json.dumps(_engine._intervals_data, indent=2, default=str), encoding="utf-8")\n' +
            '        if getattr(_engine, "_routes_data", None) is not None:\n' +
            '            Path("routes.json").write_text(json.dumps(_engine._routes_data, indent=2, default=str), encoding="utf-8")\n' +
            '        if getattr(_engine, "_saved_workouts_data", None) is not None:\n' +
            '            _engine._sw_write(_engine._saved_workouts_data)\n' +
            '        _sync_result["files"] = {"latest.json": json.dumps(_data, indent=2, default=str)}\n' +
            '        for _filename in ("history.json", "intervals.json", "routes.json", "saved_workouts.json", "ftp_history.json"):\n' +
            '            _file_path = Path(_filename)\n' +
            '            if _file_path.is_file():\n' +
            '                _sync_result["files"][_filename] = _file_path.read_text(encoding="utf-8")\n' +
            'except Exception as _error:\n' +
            '    _message = str(_error)\n' +
            '    for _secret in (_sync_input.get("intervalsKey", ""), _sync_input.get("athleteId", "")):\n' +
            '        if _secret:\n' +
            '            _message = _message.replace(_secret, "[redacted]")\n' +
            '    _sync_result = {"error": type(_error).__name__ + ": " + _message}\n' +
            'SYNC_OUTPUT_JSON = json.dumps(_sync_result)\n'
        );
        var output = pyodide.globals.get('SYNC_OUTPUT_JSON').toString();
        var result = JSON.parse(output);
        if (result.error) {
            throw new Error(result.error);
        }
        report('result', result);
    } catch (error) {
        report('error', (error && error.message) || 'On-device sync failed.');
    } finally {
        active = false;
        self.close();
    }
};

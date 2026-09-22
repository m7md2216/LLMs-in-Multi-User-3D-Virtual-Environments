# One LLM agent, two people, one shared 3D room

A browser-based 3D room in which two people talk with one LLM agent. The agent
decides for itself whether each utterance was addressed to it, using only what
was said and where each speaker's head is pointing. Nobody tells it the
addressee.

The demonstrator runs the same decision code as the paper's Experiment 1
(`src/agent.py`, `src/state_machine.py`, condition P1b with empty profiles).
The corpus and evaluation code will be added to this repository.

## Requirements

- Python 3.10+ and `pip install -r requirements.txt`
- [Ollama](https://ollama.com) with the agent model: `ollama pull qwen3.6:27b`
  (about 17 GB of GPU memory at 4-bit; set `base_url` in `models.yaml` to use
  Ollama on another machine)

## Run

    python demo/server.py

Open <http://localhost:8899> in two browser windows and enter a name in each.
Look at the robot and ask a question: it answers. Turn to face the other person
and ask the same question: it stays silent.

`demo/README.md` covers controls, the single-user mode, and asset credits.

## Layout

| path | contents |
|---|---|
| `demo/` | the 3D room (three.js) and the websocket relay `server.py` |
| `src/agent.py`, `src/state_machine.py` | the experiment's addressee decision and prompt rendering |
| `src/llm.py` | model access and a local response cache |
| `src/test_demo_schema.py` | checks that the demo's observations match the experiment's |
| `models.yaml` | which model and Ollama server to use |

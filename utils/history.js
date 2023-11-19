import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { getQueryDocs } from './queries.js';
import { getSkillDocs } from './skill_library.js';
import { sendRequest, embed, cosineSimilarity } from './gpt.js';


export class History {
    constructor(agent, save_path) {
        this.name = agent.name;
        this.save_path = save_path;
        this.turns = [];

        // These define an agent's long term memory
        this.bio = '';
        this.memory = '';

        // Variables for controlling the agent's memory and knowledge
        this.max_messages = 20;
        this.fewshot = 5;
        this.examples = [];
        this.selected_examples = [];
    }

    getHistory() {
        return this.turns;
    }

    getSystemMessage(include_examples=true) {
        let system_message = `You are a playful Minecraft bot named '${this.name}' that can communicate with players, see, move, mine, build, and interact with the world by writing and executing code.
        Act human-like as if you were a typical Minecraft player, rather than an AI. Be brief in your responses, omit needless words, and do not give instructions unless asked.`;
        system_message += getQueryDocs();
        system_message += getSkillDocs();
        if (this.bio != '')
            system_message += '\n\nBio:\n' + this.bio;
        if (this.memory != '')
            system_message += '\n\nMemory:\n' + this.memory;
        if (include_examples && this.selected_examples.length > 0) {
            for (let i = 0; i < this.selected_examples.length; i++) {
                system_message += '\n\nExample ' + (i+1) + ':\n\n';
                system_message += this.stringifyTurns(this.selected_examples[i].turns);
            }
        }
        return system_message;
    }

    stringifyTurns(turns) {
        let res = '';
        for (let turn of turns) {
            if (turn.role === 'assistant') {
                res += `\n\nYour output:\n${turn.content}`;
            } else if (turn.role === 'system') {
                res += `\n\nSystem output: ${turn.content}`;
            } else {
                res += `\n\nUser input: ${turn.content}`;
            
            }
        }
        return res.trim();
    }

    async storeMemories(turns) {
        let memory_prompt = 'Update your "Memory" with the following conversation. Your "Memory" is for storing information that will help you improve as a Minecraft bot. Include details about your interactions with other players that you may need to remember for later. Also include things that you have learned through player feedback or by executing code. Do not include information found in your Docs or that you got right on the first try.';
        if (this.memory != '') {
            memory_prompt += ' Include information from your previous memory if it is still relevant. Your output will replace your previous memory.';
        }
        memory_prompt += ' Your output should be a brief list of things you have learned using the following formats:\n';
        memory_prompt += '- When the player... output...\n';
        memory_prompt += '- I learned that player [name]...\n';

        memory_prompt += this.stringifyTurns(turns);
        let memory_turns = [{'role': 'user', 'content': memory_prompt}]
        this.memory = await sendRequest(memory_turns, this.getSystemMessage(false));
    }

    async loadExamples() {
        let examples = [];
        try {
            const data = readFileSync('utils/examples.json', 'utf8');
            examples = JSON.parse(data);
        } catch (err) {
            console.log('No history examples found.');
        }

        this.examples = [];
        for (let example of examples) {
            let messages = '';
            for (let turn of example) {
                if (turn.role != 'assistant')
                    messages += turn.content.substring(turn.content.indexOf(':')+1).trim() + '\n';
            }
            messages = messages.trim();
            const embedding = await embed(messages);
            this.examples.push({'embedding': embedding, 'turns': example});
        }
    }

    async setExamples() {
        let messages = '';
        for (let turn of this.turns) {
            if (turn.role != 'assistant')
                messages += turn.content.substring(turn.content.indexOf(':')+1).trim() + '\n';
        }
        messages = messages.trim();
        const embedding = await embed(messages);
        this.examples.sort((a, b) => {
            return cosineSimilarity(a.embedding, embedding) - cosineSimilarity(b.embedding, embedding);
        });
        this.selected_examples = this.examples.slice(-this.fewshot);
        for (let example of this.selected_examples) {
            console.log('selected example: ', example.turns[0].content);
        }
    }

    async add(name, content) {
        let role = 'assistant';
        if (name === 'system') {
            role = 'system';
        }
        else if (name !== this.name) {
            role = 'user';
            content = `${name}: ${content}`;
        }
        this.turns.push({role, content});

        // Summarize older turns into memory
        if (this.turns.length >= this.max_messages) {
            console.log('summarizing memory')
            let to_summarize = [this.turns.shift()];
            while (this.turns[0].role != 'user' && this.turns.length > 0)
                to_summarize.push(this.turns.shift());
            await this.storeMemories(to_summarize);
        }

        if (role === 'user')
            await this.setExamples();
    }

    save() {
        if (this.save_path === '' || this.save_path == null) return;
        // save history object to json file
        mkdirSync('bots', { recursive: true });
        let data = {
            'name': this.name,
            'bio': this.bio,
            'memory': this.memory,
            'turns': this.turns
        };
        const json_data = JSON.stringify(data, null, 4);
        writeFileSync(this.save_path, json_data, (err) => {
            if (err) {
                throw err;
            }
            console.log("JSON data is saved.");
        });
    }

    load() {
        if (this.save_path === '' || this.save_path == null) return;
        try {
            // load history object from json file
            const data = readFileSync(this.save_path, 'utf8');
            const obj = JSON.parse(data);
            this.turns = obj.turns;
            this.bio = obj.bio;
            this.memory = obj.memory;
            this.num_saved_turns = obj.num_saved_turns;
        } catch (err) {
            console.log('No history file found for ' + this.name + '.');
        }
    }
}
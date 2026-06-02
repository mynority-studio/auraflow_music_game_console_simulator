import imp.lickgen.Grammar;
import imp.lickgen.LickGen;
import imp.lickgen.NoteChooser;
import imp.lickgen.Terminals;
import imp.voicing.VoicingGenerator;
import imp.data.Chord;
import imp.data.ChordPart;
import imp.data.Note;
import imp.data.Score;
import imp.data.Part;
import imp.data.Unit;
import imp.data.advice.Advisor;
import imp.gui.Notate;
import imp.roadmap.RoadMap;
import imp.roadmap.brickdictionary.Block;
import imp.util.Preferences;
import java.io.FileInputStream;
import java.io.BufferedReader;
import java.io.FileReader;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Random;
import polya.Polylist;
import polya.PolylistBuffer;
import polya.PolylistEnum;
import polya.Tokenizer;
import sun.misc.Unsafe;

public final class ImprovisorOracle {
    private ImprovisorOracle() {}

    public static void main(String[] args) {
        try {
            if (args.length < 1) usage();
            String command = args[0];
            if ("grammar-run".equals(command)) {
                if (args.length != 3 && args.length != 4) usage();
                if (args.length == 4) setMathRandomSeed(Long.parseLong(args[3]));
                runGrammar(args[1], Integer.parseInt(args[2]), null);
                return;
            }
            if ("grammar-ast".equals(command)) {
                if (args.length != 2) usage();
                runGrammarAst(args[1]);
                return;
            }
            if ("grammar-candidates".equals(command)) {
                if (args.length != 4 && args.length != 6) usage();
                Notate notate = args.length == 6 ? fakeNotate(chordPart(args[4])) : null;
                int chordSlot = args.length == 6 ? Integer.parseInt(args[5]) : 0;
                runGrammarCandidates(args[1], Integer.parseInt(args[2]), args[3], notate, chordSlot);
                return;
            }
            if ("grammar-candidates-batch".equals(command)) {
                if (args.length != 4) usage();
                runGrammarCandidatesBatch(args[1], Integer.parseInt(args[2]), args[3]);
                return;
            }
            if ("grammar-candidates-batch-chords".equals(command)) {
                if (args.length != 5) usage();
                runGrammarCandidatesBatchChords(args[1], Integer.parseInt(args[2]), args[3], args[4]);
                return;
            }
            if ("grammar-candidates-batch-bricks".equals(command)) {
                if (args.length != 5) usage();
                runGrammarCandidatesBatchBricks(args[1], Integer.parseInt(args[2]), args[3], args[4]);
                return;
            }
            if ("grammar-run-chords".equals(command)) {
                if (args.length != 4 && args.length != 5) usage();
                if (args.length == 5) setMathRandomSeed(Long.parseLong(args[4]));
                runGrammar(args[1], Integer.parseInt(args[2]), fakeNotate(chordPart(args[3])));
                return;
            }
            if ("relative-note".equals(command)) {
                if (args.length != 3) usage();
                runRelativeNote(args[1], args[2]);
                return;
            }
            if ("relative-note-batch".equals(command)) {
                if (args.length != 2) usage();
                runRelativeNoteBatch(args[1]);
                return;
            }
            if ("notechooser-prob-table".equals(command)) {
                if (args.length != 1) usage();
                runNoteChooserProbTable();
                return;
            }
            if ("notechooser-branch-space".equals(command)) {
                if (args.length != 10) usage();
                runNoteChooserBranchSpace(args);
                return;
            }
            if ("lickgen-choose-state".equals(command)) {
                if (args.length != 9) usage();
                runLickGenChooseState(args);
                return;
            }
            if ("lickgen-choose-state-batch".equals(command)) {
                if (args.length != 2) usage();
                runLickGenChooseStateBatch(args[1]);
                return;
            }
            if ("voicing".equals(command)) {
                if (args.length != 19) usage();
                setMathRandomSeed(Long.parseLong(args[1]));
                runVoicing(args);
                return;
            }
            usage();
        } catch (Throwable t) {
            System.err.println(t.getClass().getName() + ": " + t.getMessage());
            t.printStackTrace(System.err);
            System.exit(1);
        }
    }

    private static void usage() {
        System.err.println("Usage:");
        System.err.println("  java ImprovisorOracle grammar-run <grammar-file> <slots> [math-random-seed]");
        System.err.println("  java ImprovisorOracle grammar-ast <grammar-file>");
        System.err.println("  java ImprovisorOracle grammar-candidates <grammar-file> <start-slots> <token-sexpr> [<chord:dur,...> <chord-slot>]");
        System.err.println("  java ImprovisorOracle grammar-candidates-batch <grammar-file> <start-slots> <token-sexpr-file>");
        System.err.println("  java ImprovisorOracle grammar-candidates-batch-chords <grammar-file> <start-slots> <chord:dur,...> <slot-tab-token-sexpr-file>");
        System.err.println("  java ImprovisorOracle grammar-candidates-batch-bricks <grammar-file> <start-slots> <brick:dur,...> <slot-tab-token-sexpr-file>");
        System.err.println("  java ImprovisorOracle grammar-run-chords <grammar-file> <slots> <chord:dur,...> [math-random-seed]");
        System.err.println("  java ImprovisorOracle relative-note <sexpr-note> <chord>");
        System.err.println("  java ImprovisorOracle relative-note-batch <tsv-file: chord TAB sexpr-note>");
        System.err.println("  java ImprovisorOracle notechooser-prob-table");
        System.err.println("  java ImprovisorOracle notechooser-branch-space <minPitch> <maxPitch> <low> <high> <type> <numTypesCsv> <noteTypesCsv> <attempt> <doNotSwitchOctave>");
        System.err.println("  java ImprovisorOracle lickgen-choose-state <pos> <low> <high> <chord:dur,...> <type> <lastPitch> <minPitch> <maxPitch>");
        System.err.println("  java ImprovisorOracle lickgen-choose-state-batch <tsv-file: label TAB pos TAB low TAB high TAB chordSpec TAB type TAB lastPitch TAB minPitch TAB maxPitch>");
        System.err.println("  java ImprovisorOracle voicing <seed> <priorityCsv> <colorCsv> <root> <leftLow> <leftHigh> <leftN> <rightLow> <rightHigh> <rightN> <previousCsv|-> <prevMult> <halfAway> <fullAway> <priorityMult> <repeatMult> <halfReduce> <fullReduce>");
        System.exit(2);
    }

    private static void setMathRandomSeed(long seed) throws Exception {
        Class<?> holder = Class.forName("java.lang.Math$RandomNumberGeneratorHolder");
        Field field = holder.getDeclaredField("randomNumberGenerator");
        field.setAccessible(true);
        Random random = (Random) field.get(null);
        random.setSeed(seed);
    }

    private static void runGrammar(String grammarFile, int slots, Notate notate) {
        Grammar grammar = new Grammar(grammarFile);
        Polylist out = grammar.run(0, slots, notate, false, true, slots);
        StringBuilder json = new StringBuilder();
        json.append("{");
        field(json, "kind", "grammar-run").append(",");
        field(json, "grammarFile", grammarFile).append(",");
        numberField(json, "slots", slots).append(",");
        numberField(json, "durationSlots", Terminals.getDurationAbstractMelody(out)).append(",");
        json.append("\"sexpr\":");
        string(json, out.toString()).append(",");
        json.append("\"tokens\":");
        polylistAsJsonArray(json, out);
        json.append("}");
        System.out.println(json.toString());
    }

    private static void runGrammarAst(String grammarFile) {
        Grammar grammar = new Grammar(grammarFile);
        StringBuilder json = new StringBuilder();
        json.append("{");
        field(json, "kind", "grammar-ast").append(",");
        field(json, "grammarFile", grammarFile).append(",");
        json.append("\"rules\":");
        polylistAsJsonArray(json, grammar.getRules());
        json.append("}");
        System.out.println(json.toString());
    }

    private static void runGrammarCandidates(String grammarFile, int startSlots, String tokenSexpr, Notate notate, int chordSlot) throws Exception {
        initPreferences();
        initAdvisor();
        Grammar grammar = new Grammar(grammarFile);
        grammar.addStart(startSlots);
        if (notate != null) {
            setField(Grammar.class, grammar, "notate", notate);
        }
        setField(Grammar.class, grammar, "chordSlot", chordSlot);

        Object parsedToken = Polylist.PolylistFromString(tokenSexpr).first();
        if (!(parsedToken instanceof Polylist)) parsedToken = Polylist.list(parsedToken);
        ArrayList<Object[]> candidates = grammarCandidates(grammar, (Polylist) parsedToken);

        StringBuilder json = new StringBuilder();
        json.append("{");
        field(json, "kind", "grammar-candidates").append(",");
        field(json, "grammarFile", grammarFile).append(",");
        numberField(json, "startSlots", startSlots).append(",");
        json.append("\"token\":");
        value(json, parsedToken);
        json.append(",");
        numberField(json, "chordSlot", chordSlot).append(",");
        json.append("\"candidates\":[");
        for (int i = 0; i < candidates.size(); i++) {
            if (i > 0) json.append(",");
            Object[] c = candidates.get(i);
            json.append("{");
            json.append("\"lhs\":");
            value(json, c[0]);
            json.append(",");
            json.append("\"rhs\":");
            value(json, c[1]);
            json.append(",");
            json.append("\"weight\":").append(((Double) c[2]).doubleValue());
            json.append("}");
        }
        json.append("]}");
        System.out.println(json.toString());
    }

    private static void runGrammarCandidatesBatch(String grammarFile, int startSlots, String tokenFile) throws Exception {
        initPreferences();
        initAdvisor();
        Grammar grammar = new Grammar(grammarFile);
        grammar.addStart(startSlots);
        setField(Grammar.class, grammar, "chordSlot", 0);

        StringBuilder json = new StringBuilder();
        json.append("{");
        field(json, "kind", "grammar-candidates-batch").append(",");
        field(json, "grammarFile", grammarFile).append(",");
        numberField(json, "startSlots", startSlots).append(",");
        json.append("\"items\":[");
        BufferedReader reader = new BufferedReader(new FileReader(tokenFile));
        String line;
        boolean first = true;
        while ((line = reader.readLine()) != null) {
            if (line.trim().length() == 0) continue;
            Object parsedToken = Polylist.PolylistFromString(line).first();
            if (!(parsedToken instanceof Polylist)) parsedToken = Polylist.list(parsedToken);
            ArrayList<Object[]> candidates = grammarCandidates(grammar, (Polylist) parsedToken);
            if (!first) json.append(",");
            first = false;
            json.append("{\"token\":");
            value(json, parsedToken);
            json.append(",\"candidates\":[");
            for (int i = 0; i < candidates.size(); i++) {
                if (i > 0) json.append(",");
                Object[] c = candidates.get(i);
                json.append("{\"lhs\":");
                value(json, c[0]);
                json.append(",\"rhs\":");
                value(json, c[1]);
                json.append(",\"weight\":").append(((Double) c[2]).doubleValue()).append("}");
            }
            json.append("]}");
        }
        reader.close();
        json.append("]}");
        System.out.println(json.toString());
    }

    private static void runGrammarCandidatesBatchChords(String grammarFile, int startSlots, String chordSpec, String tokenFile) throws Exception {
        initPreferences();
        initAdvisor();
        Grammar grammar = new Grammar(grammarFile);
        grammar.addStart(startSlots);
        setField(Grammar.class, grammar, "notate", fakeNotate(chordPart(chordSpec)));

        StringBuilder json = new StringBuilder();
        json.append("{");
        field(json, "kind", "grammar-candidates-batch-chords").append(",");
        field(json, "grammarFile", grammarFile).append(",");
        numberField(json, "startSlots", startSlots).append(",");
        field(json, "chordSpec", chordSpec).append(",");
        json.append("\"items\":[");
        BufferedReader reader = new BufferedReader(new FileReader(tokenFile));
        String line;
        boolean first = true;
        while ((line = reader.readLine()) != null) {
            if (line.trim().length() == 0) continue;
            String[] parts = line.split("\t", 2);
            if (parts.length != 2) throw new IllegalArgumentException("Bad grammar candidates chord batch line: " + line);
            int chordSlot = Integer.parseInt(parts[0]);
            setField(Grammar.class, grammar, "chordSlot", chordSlot);
            Object parsedToken = Polylist.PolylistFromString(parts[1]).first();
            if (!(parsedToken instanceof Polylist)) parsedToken = Polylist.list(parsedToken);
            ArrayList<Object[]> candidates = grammarCandidates(grammar, (Polylist) parsedToken);
            if (!first) json.append(",");
            first = false;
            json.append("{\"chordSlot\":").append(chordSlot).append(",\"token\":");
            value(json, parsedToken);
            json.append(",\"candidates\":[");
            for (int i = 0; i < candidates.size(); i++) {
                if (i > 0) json.append(",");
                Object[] c = candidates.get(i);
                json.append("{\"lhs\":");
                value(json, c[0]);
                json.append(",\"rhs\":");
                value(json, c[1]);
                json.append(",\"weight\":").append(((Double) c[2]).doubleValue()).append("}");
            }
            json.append("]}");
        }
        reader.close();
        json.append("]}");
        System.out.println(json.toString());
    }

    private static void runGrammarCandidatesBatchBricks(String grammarFile, int startSlots, String brickSpec, String tokenFile) throws Exception {
        initPreferences();
        initAdvisor();
        Grammar grammar = new Grammar(grammarFile);
        grammar.addStart(startSlots);
        setField(Grammar.class, grammar, "notate", fakeNotate(chordPartWithRoadMap(brickSpec)));

        StringBuilder json = new StringBuilder();
        json.append("{");
        field(json, "kind", "grammar-candidates-batch-bricks").append(",");
        field(json, "grammarFile", grammarFile).append(",");
        numberField(json, "startSlots", startSlots).append(",");
        field(json, "brickSpec", brickSpec).append(",");
        json.append("\"items\":[");
        BufferedReader reader = new BufferedReader(new FileReader(tokenFile));
        String line;
        boolean first = true;
        while ((line = reader.readLine()) != null) {
            if (line.trim().length() == 0) continue;
            String[] parts = line.split("\t", 2);
            if (parts.length != 2) throw new IllegalArgumentException("Bad grammar candidates brick batch line: " + line);
            int chordSlot = Integer.parseInt(parts[0]);
            setField(Grammar.class, grammar, "chordSlot", chordSlot);
            Object parsedToken = Polylist.PolylistFromString(parts[1]).first();
            if (!(parsedToken instanceof Polylist)) parsedToken = Polylist.list(parsedToken);
            ArrayList<Object[]> candidates = grammarCandidates(grammar, (Polylist) parsedToken);
            if (!first) json.append(",");
            first = false;
            json.append("{\"chordSlot\":").append(chordSlot).append(",\"token\":");
            value(json, parsedToken);
            json.append(",\"candidates\":[");
            for (int i = 0; i < candidates.size(); i++) {
                if (i > 0) json.append(",");
                Object[] c = candidates.get(i);
                json.append("{\"lhs\":");
                value(json, c[0]);
                json.append(",\"rhs\":");
                value(json, c[1]);
                json.append(",\"weight\":").append(((Double) c[2]).doubleValue()).append("}");
            }
            json.append("]}");
        }
        reader.close();
        json.append("]}");
        System.out.println(json.toString());
    }

    private static ArrayList<Object[]> grammarCandidates(Grammar grammar, Polylist token) throws Exception {
        ArrayList<Object[]> out = new ArrayList<Object[]>();
        Polylist rules = grammar.getRules();
        String startSymbol = (String) getField(Grammar.class, grammar, "startSymbol");
        java.lang.reflect.Method setVars = Grammar.class.getDeclaredMethod("setVars", Polylist.class, Polylist.class, Polylist.class);
        java.lang.reflect.Method evaluate = Grammar.class.getDeclaredMethod("evaluate", Object.class);
        setVars.setAccessible(true);
        evaluate.setAccessible(true);

        for (Polylist search = rules; search.nonEmpty(); search = search.rest()) {
            Polylist next = (Polylist) search.first();
            if (next == null || next.isEmpty() || !(next.first() instanceof String)) continue;
            String type = (String) next.first();
            if (!"rule".equals(type) || next.length() != 4) continue;

            Object rawLHS = next.second();
            Object rawRHS = next.third();
            Polylist lhs = rawLHS instanceof Polylist ? (Polylist) rawLHS : Polylist.list(rawLHS);
            Polylist rhs = rawRHS instanceof Polylist ? (Polylist) rawRHS : Polylist.list(rawRHS);
            if (!(token.first() instanceof String) || !((String) token.first()).equals(lhs.first())) continue;

            rhs = (Polylist) setVars.invoke(grammar, token, lhs, rhs);
            if (rhs == null) continue;
            Object evaluated = evaluate.invoke(grammar, rhs);
            if (!(evaluated instanceof Polylist)) continue;
            rhs = (Polylist) evaluated;

            PolylistBuffer buffer = new PolylistBuffer();
            for (PolylistEnum e = rhs.elements(); e.hasMoreElements();) {
                Object ob = e.nextElement();
                if (ob instanceof Polylist) {
                    Polylist p = (Polylist) ob;
                    if (p.length() == 2 && p.first().equals(startSymbol)) {
                        Object arg = p.second();
                        if (arg instanceof Number && ((Number) arg).intValue() <= 0) {
                            continue;
                        }
                    }
                }
                buffer.append(ob);
            }
            rhs = buffer.toPolylist();

            Object weightValue = evaluate.invoke(grammar, next.fourth());
            if (weightValue instanceof Number) {
                double weight = ((Number) weightValue).doubleValue();
                if (weight > 0) out.add(new Object[] { lhs, rhs, new Double(weight) });
            }
        }
        return out;
    }

    private static void runRelativeNote(String sexprNote, String chordName) {
        initPreferences();
        initAdvisor();
        System.out.println(relativeNoteJson(sexprNote, chordName));
    }

    private static void runRelativeNoteBatch(String tsvFile) throws Exception {
        initPreferences();
        initAdvisor();
        StringBuilder json = new StringBuilder();
        json.append("[");
        BufferedReader reader = new BufferedReader(new FileReader(tsvFile));
        String line;
        boolean first = true;
        while ((line = reader.readLine()) != null) {
            if (line.trim().length() == 0) continue;
            String[] parts = line.split("\t", 2);
            if (parts.length != 2) throw new IllegalArgumentException("Bad relative-note batch line: " + line);
            if (!first) json.append(",");
            first = false;
            json.append(relativeNoteJson(parts[1], parts[0]));
        }
        reader.close();
        json.append("]");
        System.out.println(json.toString());
    }

    private static String relativeNoteJson(String sexprNote, String chordName) {
        Object parsed = Polylist.PolylistFromString(sexprNote).first();
        Chord chord = Chord.makeChord(chordName, 480);
        if (chord == null) throw new IllegalArgumentException("Bad chord name: " + chordName);
        Note note = imp.lickgen.LickGen.makeRelativeNote(parsed, chord);
        StringBuilder json = new StringBuilder();
        json.append("{");
        field(json, "kind", "relative-note").append(",");
        field(json, "input", sexprNote).append(",");
        field(json, "chord", chordName).append(",");
        if (note == null) {
            json.append("\"note\":null");
        } else {
            json.append("\"note\":{");
            numberField(json, "pitch", note.getPitch()).append(",");
            numberField(json, "durationSlots", note.getRhythmValue()).append(",");
            field(json, "leadsheet", note.toLeadsheet());
            json.append("}");
        }
        json.append("}");
        return json.toString();
    }

    private static void runNoteChooserProbTable() throws Exception {
        NoteChooser chooser = new NoteChooser(false);
        Field probabilitiesField = NoteChooser.class.getDeclaredField("probabilities");
        probabilitiesField.setAccessible(true);
        Polylist probabilities = (Polylist) probabilitiesField.get(chooser);
        StringBuilder json = new StringBuilder();
        json.append("{");
        field(json, "kind", "notechooser-prob-table").append(",");
        json.append("\"rows\":[");
        boolean firstRow = true;
        for (PolylistEnum e = probabilities.elements(); e.hasMoreElements();) {
            if (!firstRow) json.append(",");
            firstRow = false;
            polylistAsJsonArray(json, (Polylist) e.nextElement());
        }
        json.append("]}");
        System.out.println(json.toString());
    }

    private static void runNoteChooserBranchSpace(String[] args) throws Exception {
        int minPitch = Integer.parseInt(args[1]);
        int maxPitch = Integer.parseInt(args[2]);
        int low = Integer.parseInt(args[3]);
        int high = Integer.parseInt(args[4]);
        int type = Integer.parseInt(args[5]);
        int[] numTypes = parseIntCsv(args[6]);
        int[] noteTypes = parseIntCsv(args[7]);
        int attempt = Integer.parseInt(args[8]);
        boolean doNotSwitchOctave = Boolean.parseBoolean(args[9]);
        if (numTypes.length != 4) throw new IllegalArgumentException("numTypesCsv must have 4 values");
        if (noteTypes.length != high - low + 1) throw new IllegalArgumentException("noteTypes length must equal high-low+1");

        int rowType = noteChooserRowType(type);
        int haveChord = numTypes[0] != 0 ? 1 : 0;
        int haveColor = numTypes[1] != 0 ? 1 : 0;
        int haveRandom = numTypes[2] != 0 ? 1 : 0;
        int[] probs = noteChooserProbabilities(rowType, haveChord, haveColor, haveRandom);
        int[] typeMap = new int[] { NoteChooser.CHORD, NoteChooser.COLOR, NoteChooser.RANDOM, NoteChooser.SCALE };
        int[] counts = new int[Math.max(0, high - low + 1 + 48)];
        int offset = low - 24;
        int total = 0;

        for (int rand1 = 1; rand1 <= 100; rand1++) {
            int remaining = rand1;
            int newType = 0;
            for (int i = 0; i < probs.length; i++) {
                remaining -= probs[i];
                if (remaining <= 0) {
                    newType = i;
                    break;
                }
            }
            if (numTypes[newType] <= 0) continue;
            for (int rand2 = 1; rand2 <= numTypes[newType]; rand2++) {
                int nth = rand2;
                int pitchdiff = 0;
                for (int i = 0; i < noteTypes.length; i++) {
                    if (noteTypes[i] == typeMap[newType] || (newType == 3 && (noteTypes[i] == NoteChooser.CHORD || noteTypes[i] == NoteChooser.COLOR))) {
                        nth--;
                    }
                    if (nth <= 0) {
                        pitchdiff = i;
                        break;
                    }
                }
                int finalPitch = low + pitchdiff;
                if (attempt >= LickGen.MELODY_GEN_LIMIT - 1 && !doNotSwitchOctave) {
                    while (finalPitch > maxPitch) finalPitch -= 12;
                    while (finalPitch < minPitch) finalPitch += 12;
                }
                int idx = finalPitch - offset;
                if (idx < 0 || idx >= counts.length) throw new IllegalStateException("pitch outside histogram: " + finalPitch);
                counts[idx]++;
                total++;
            }
        }

        StringBuilder json = new StringBuilder();
        json.append("{");
        field(json, "kind", "notechooser-branch-space").append(",");
        numberField(json, "minPitch", minPitch).append(",");
        numberField(json, "maxPitch", maxPitch).append(",");
        numberField(json, "low", low).append(",");
        numberField(json, "high", high).append(",");
        numberField(json, "type", type).append(",");
        json.append("\"numTypes\":");
        intArray(json, numTypes).append(",");
        json.append("\"noteTypes\":");
        intArray(json, noteTypes).append(",");
        numberField(json, "attempt", attempt).append(",");
        json.append("\"doNotSwitchOctave\":").append(doNotSwitchOctave ? "true" : "false").append(",");
        numberField(json, "totalBranches", total).append(",");
        json.append("\"distribution\":{");
        boolean first = true;
        for (int i = 0; i < counts.length; i++) {
            if (counts[i] == 0) continue;
            if (!first) json.append(",");
            first = false;
            json.append("\"").append(i + offset).append("\":").append(counts[i]);
        }
        json.append("}}");
        System.out.println(json.toString());
    }

    private static int noteChooserRowType(int type) {
        if (type == NoteChooser.CHORD) return 0;
        if (type == NoteChooser.COLOR) return 1;
        if (type == NoteChooser.RANDOM) return 2;
        if (type == NoteChooser.SCALE) return 3;
        return type;
    }

    private static int[] noteChooserProbabilities(int type, int haveChord, int haveColor, int haveRandom) throws Exception {
        NoteChooser chooser = new NoteChooser(false);
        Field probabilitiesField = NoteChooser.class.getDeclaredField("probabilities");
        probabilitiesField.setAccessible(true);
        Polylist probabilities = (Polylist) probabilitiesField.get(chooser);
        for (PolylistEnum e = probabilities.elements(); e.hasMoreElements();) {
            Polylist row = (Polylist) e.nextElement();
            if (((Number) row.first()).intValue() == type
                    && ((Number) row.second()).intValue() == haveChord
                    && ((Number) row.third()).intValue() == haveColor
                    && ((Number) row.fourth()).intValue() == haveRandom) {
                return new int[] {
                    ((Number) row.fifth()).intValue(),
                    ((Number) row.nth(5)).intValue(),
                    ((Number) row.nth(6)).intValue(),
                    ((Number) row.nth(7)).intValue(),
                };
            }
        }
        throw new IllegalArgumentException("No NoteChooser probability row for " + type + "/" + haveChord + "/" + haveColor + "/" + haveRandom);
    }

    private static void runLickGenChooseState(String[] args) throws Exception {
        int pos = Integer.parseInt(args[1]);
        int low = Integer.parseInt(args[2]);
        int high = Integer.parseInt(args[3]);
        String chordSpec = args[4];
        int type = Integer.parseInt(args[5]);
        int lastPitch = Integer.parseInt(args[6]);
        int minPitch = Integer.parseInt(args[7]);
        int maxPitch = Integer.parseInt(args[8]);
        ChooseState state = lickGenChooseState(pos, low, high, chordSpec, type, lastPitch, minPitch, maxPitch);

        StringBuilder json = new StringBuilder();
        chooseStateJson(json, state);
        System.out.println(json.toString());
    }

    private static void runLickGenChooseStateBatch(String casesFile) throws Exception {
        StringBuilder json = new StringBuilder();
        json.append("{\"kind\":\"lickgen-choose-state-batch\",\"items\":[");
        BufferedReader reader = new BufferedReader(new FileReader(casesFile));
        String line;
        boolean first = true;
        while ((line = reader.readLine()) != null) {
            if (line.trim().length() == 0) continue;
            String[] parts = line.split("\t");
            if (parts.length != 9) throw new IllegalArgumentException("Bad choose-state batch line: " + line);
            ChooseState state = lickGenChooseState(
                Integer.parseInt(parts[1]),
                Integer.parseInt(parts[2]),
                Integer.parseInt(parts[3]),
                parts[4],
                Integer.parseInt(parts[5]),
                Integer.parseInt(parts[6]),
                Integer.parseInt(parts[7]),
                Integer.parseInt(parts[8]));
            if (!first) json.append(",");
            first = false;
            json.append("{");
            field(json, "label", parts[0]).append(",");
            chooseStateFields(json, state);
            json.append("}");
        }
        reader.close();
        json.append("]}");
        System.out.println(json.toString());
    }

    private static ChooseState lickGenChooseState(int pos, int low, int high, String chordSpec, int type, int lastPitch, int minPitch, int maxPitch) throws Exception {
        ChordPart cp = chordPart(chordSpec);
        LickGen gen = (LickGen) unsafe().allocateInstance(LickGen.class);
        setField(LickGen.class, gen, "preferredScale", Polylist.list("C", "Use_First_Scale"));
        setField(LickGen.class, gen, "oldPitch", new Integer(lastPitch));
        setField(LickGen.class, gen, "doNotSwitchOctave", Boolean.FALSE);

        int adjustedLow = low;
        int adjustedHigh = high;
        int adjustedType = type;
        if (adjustedLow == adjustedHigh) {
            if (adjustedLow != lastPitch + 1) adjustedLow--;
            if (adjustedHigh != lastPitch - 1) adjustedHigh++;
        }
        if (adjustedLow - lastPitch >= 6) adjustedLow -= 3;
        if (adjustedHigh - lastPitch <= -6) adjustedHigh += 3;
        if (adjustedLow > adjustedHigh && adjustedLow > lastPitch) adjustedLow = adjustedHigh;
        if (adjustedHigh < adjustedLow && adjustedHigh < lastPitch) adjustedHigh = adjustedLow;
        if (adjustedType == NoteChooser.NOTE) adjustedType = NoteChooser.SCALE;

        Chord chord = cp.getCurrentChord(pos);
        if (chord == null) {
            adjustedType = NoteChooser.RANDOM;
        } else if (chord.getName().equals(Chord.NOCHORD)) {
            chord = cp.getNextUniqueChord(pos);
        } else if (chord.getName().equals(Chord.NOCHORD)) {
            chord = cp.getPrevChord(pos);
        }
        if (chord == null || chord.getName().equals(Chord.NOCHORD)) adjustedType = NoteChooser.RANDOM;

        int[] numTypes = new int[4];
        int[] noteTypes = new int[0];
        for (int j = 0; j == 0 || (adjustedType == NoteChooser.CHORD && j < 3 && numTypes[0] == 0); j++) {
            noteTypes = gen.getNoteTypes(pos, adjustedLow, adjustedHigh, cp);
            for (int i = 0; i < noteTypes.length; i++) {
                switch (noteTypes[i]) {
                    case NoteChooser.CHORD:
                        numTypes[0]++;
                        numTypes[3]++;
                        break;
                    case NoteChooser.COLOR:
                        numTypes[1]++;
                        numTypes[3]++;
                        break;
                    default:
                        numTypes[2]++;
                        break;
                }
            }
            if (adjustedType == NoteChooser.CHORD && numTypes[0] == 0) {
                if (adjustedLow != lastPitch + 1) adjustedLow--;
                if (adjustedHigh != lastPitch - 1) adjustedHigh++;
            }
        }

        return new ChooseState(pos, adjustedLow, adjustedHigh, adjustedType, numTypes, noteTypes);
    }

    private static void chooseStateJson(StringBuilder json, ChooseState state) {
        json.append("{");
        chooseStateFields(json, state);
        json.append("}");
    }

    private static void chooseStateFields(StringBuilder json, ChooseState state) {
        field(json, "kind", "lickgen-choose-state").append(",");
        numberField(json, "pos", state.pos).append(",");
        numberField(json, "low", state.low).append(",");
        numberField(json, "high", state.high).append(",");
        numberField(json, "type", state.type).append(",");
        json.append("\"numTypes\":");
        intArray(json, state.numTypes).append(",");
        json.append("\"noteTypes\":");
        intArray(json, state.noteTypes);
    }

    private static final class ChooseState {
        final int pos;
        final int low;
        final int high;
        final int type;
        final int[] numTypes;
        final int[] noteTypes;

        ChooseState(int pos, int low, int high, int type, int[] numTypes, int[] noteTypes) {
            this.pos = pos;
            this.low = low;
            this.high = high;
            this.type = type;
            this.numTypes = numTypes;
            this.noteTypes = noteTypes;
        }
    }

    private static void runVoicing(String[] args) {
        int index = 2;
        int[] priority = parseIntCsv(args[index++]);
        int[] color = parseIntCsv(args[index++]);
        int root = Integer.parseInt(args[index++]);
        int leftLow = Integer.parseInt(args[index++]);
        int leftHigh = Integer.parseInt(args[index++]);
        int leftN = Integer.parseInt(args[index++]);
        int rightLow = Integer.parseInt(args[index++]);
        int rightHigh = Integer.parseInt(args[index++]);
        int rightN = Integer.parseInt(args[index++]);
        int[] previous = "-".equals(args[index]) ? null : parseIntCsv(args[index]);
        index++;
        double previousMultiplier = Double.parseDouble(args[index++]);
        double halfAway = Double.parseDouble(args[index++]);
        double fullAway = Double.parseDouble(args[index++]);
        double priorityMultiplier = Double.parseDouble(args[index++]);
        double repeatMultiplier = Double.parseDouble(args[index++]);
        double halfReducer = Double.parseDouble(args[index++]);
        double fullReducer = Double.parseDouble(args[index++]);

        VoicingGenerator gen = new VoicingGenerator(1, 1, 10, previousMultiplier, halfAway, fullAway, priorityMultiplier, repeatMultiplier, halfReducer, fullReducer, true);
        gen.setPriority(priority);
        gen.setColor(color);
        gen.setRoot(root);
        gen.setLowerLeftBound(leftLow);
        gen.setUpperLeftBound(leftHigh);
        gen.setNumNotesLeft(leftN);
        gen.setLowerRightBound(rightLow);
        gen.setUpperRightBound(rightHigh);
        gen.setNumNotesRight(rightN);
        gen.setPreviousVoicing(previous);
        gen.setLeftMinInterval(2);
        gen.setRightMinInterval(2);
        gen.setRootless(true);
        gen.setVoiceAll(false);
        gen.setInvertM9(true);
        gen.calculate();

        StringBuilder json = new StringBuilder();
        json.append("{");
        field(json, "kind", "voicing").append(",");
        json.append("\"left\":");
        intArray(json, gen.getLeftHand()).append(",");
        json.append("\"right\":");
        intArray(json, gen.getRightHand()).append(",");
        json.append("\"chord\":");
        intArray(json, gen.getChord());
        json.append("}");
        System.out.println(json.toString());
    }

    private static int[] parseIntCsv(String value) {
        if (value.length() == 0 || "-".equals(value)) return new int[0];
        String[] parts = value.split(",");
        int[] out = new int[parts.length];
        for (int i = 0; i < parts.length; i++) out[i] = Integer.parseInt(parts[i]);
        return out;
    }

    private static ChordPart chordPart(String spec) {
        initPreferences();
        initAdvisor();
        ChordPart cp = unsafeChordPart();
        if (spec.trim().length() == 0) return cp;
        String[] parts = spec.split(",");
        for (String part : parts) {
            String[] pair = part.trim().split(":", 2);
            if (pair.length != 2) throw new IllegalArgumentException("Bad chord spec: " + part);
            Chord chord = Chord.makeChord(pair[0], Integer.parseInt(pair[1]));
            if (chord == null) throw new IllegalArgumentException("Bad chord name: " + pair[0]);
            cp.addChord(chord);
        }
        return cp;
    }

    private static ChordPart chordPartWithRoadMap(String spec) throws Exception {
        ChordPart cp = unsafeChordPart();
        ArrayList<Block> blocks = new ArrayList<Block>();
        if (spec.trim().length() != 0) {
            String[] parts = spec.split(",");
            for (String part : parts) {
                String[] pair = part.trim().split(":", 2);
                if (pair.length != 2) throw new IllegalArgumentException("Bad brick spec: " + part);
                blocks.add(new OracleBlock(pair[0], Integer.parseInt(pair[1])));
            }
        }
        cp.setRoadmap(new RoadMap(blocks));
        return cp;
    }

    private static final class OracleBlock extends Block {
        OracleBlock(String name, int duration) {
            super(name);
            this.duration = duration;
        }

        public Polylist toPolylist() {
            return Polylist.list(name, new Integer(duration));
        }

        public Polylist toRoadmapSave() {
            return toPolylist();
        }

        public int getLength() {
            return 1;
        }

        public boolean singleChord() {
            return false;
        }
    }

    private static Notate fakeNotate(ChordPart cp) throws Exception {
        Unsafe unsafe = unsafe();
        Score score = (Score) unsafe.allocateInstance(Score.class);
        Field chordProgField = Score.class.getDeclaredField("chordProg");
        chordProgField.setAccessible(true);
        chordProgField.set(score, cp);

        Notate notate = (Notate) unsafe.allocateInstance(Notate.class);
        Field scoreField = Notate.class.getDeclaredField("score");
        scoreField.setAccessible(true);
        scoreField.set(notate, score);
        return notate;
    }

    private static ChordPart unsafeChordPart() {
        try {
            Unsafe unsafe = unsafe();
            ChordPart cp = (ChordPart) unsafe.allocateInstance(ChordPart.class);
            setField(Part.class, cp, "slots", new ArrayList<Unit>());
            setField(Part.class, cp, "size", 0);
            setField(Part.class, cp, "unitCount", 0);
            setField(Part.class, cp, "title", "");
            setField(Part.class, cp, "composer", "");
            setField(Part.class, cp, "instrument", 0);
            setField(Part.class, cp, "volume", 65);
            setField(Part.class, cp, "keySig", 0);
            setField(Part.class, cp, "metre", new int[] {4, 4});
            setField(Part.class, cp, "beatValue", 120);
            setField(Part.class, cp, "measureLength", 480);
            setField(Part.class, cp, "swing", 0.67);
            return cp;
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private static void setField(Class<?> klass, Object target, String name, Object value) throws Exception {
        Field field = klass.getDeclaredField(name);
        field.setAccessible(true);
        field.set(target, value);
    }

    private static Object getField(Class<?> klass, Object target, String name) throws Exception {
        Field field = klass.getDeclaredField(name);
        field.setAccessible(true);
        return field.get(target);
    }

    private static Unsafe unsafe() throws Exception {
        Field field = Unsafe.class.getDeclaredField("theUnsafe");
        field.setAccessible(true);
        return (Unsafe) field.get(null);
    }

    private static void initPreferences() {
        try {
            Field prefsField = Preferences.class.getDeclaredField("prefs");
            prefsField.setAccessible(true);
            Object prefs = prefsField.get(null);
            if (prefs instanceof Polylist && ((Polylist) prefs).isEmpty()) {
                prefsField.set(null, Polylist.PolylistFromString(Preferences.ALL_DEFAULTS));
            }
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private static void initAdvisor() {
        try {
            if (Advisor.getAllChords() != null && Advisor.getAllChords().nonEmpty()) return;
            String vocab = System.getenv("IMPROVISOR_ROOT");
            if (vocab == null || vocab.length() == 0) vocab = "/Users/mynority/vibe_coding/Impro-Visor";
            vocab = vocab + "/vocab/My.voc";
            Tokenizer in = new Tokenizer(new FileInputStream(vocab));
            PolylistBuffer buffer = new PolylistBuffer();
            Object ob;
            while ((ob = in.nextSexp()) != Tokenizer.eof) {
                if (ob instanceof Polylist) buffer.append(ob);
            }
            new Advisor(buffer.toPolylist());
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private static StringBuilder field(StringBuilder json, String key, String value) {
        json.append("\"").append(escape(key)).append("\":");
        return string(json, value);
    }

    private static StringBuilder numberField(StringBuilder json, String key, int value) {
        json.append("\"").append(escape(key)).append("\":").append(value);
        return json;
    }

    private static StringBuilder intArray(StringBuilder json, int[] values) {
        json.append("[");
        for (int i = 0; i < values.length; i++) {
            if (i > 0) json.append(",");
            json.append(values[i]);
        }
        json.append("]");
        return json;
    }

    private static StringBuilder string(StringBuilder json, String value) {
        json.append("\"").append(escape(value)).append("\"");
        return json;
    }

    private static void polylistAsJsonArray(StringBuilder json, Polylist list) {
        json.append("[");
        boolean first = true;
        for (PolylistEnum e = list.elements(); e.hasMoreElements();) {
            if (!first) json.append(",");
            first = false;
            value(json, e.nextElement());
        }
        json.append("]");
    }

    private static void value(StringBuilder json, Object value) {
        if (value instanceof Polylist) {
            polylistAsJsonArray(json, (Polylist) value);
        } else if (value instanceof Number) {
            json.append(value.toString());
        } else {
            string(json, String.valueOf(value));
        }
    }

    private static String escape(String in) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < in.length(); i++) {
            char c = in.charAt(i);
            switch (c) {
                case '\\': out.append("\\\\"); break;
                case '"': out.append("\\\""); break;
                case '\b': out.append("\\b"); break;
                case '\f': out.append("\\f"); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        String hex = Integer.toHexString(c);
                        out.append("\\u");
                        for (int j = hex.length(); j < 4; j++) out.append('0');
                        out.append(hex);
                    } else {
                        out.append(c);
                    }
            }
        }
        return out.toString();
    }
}

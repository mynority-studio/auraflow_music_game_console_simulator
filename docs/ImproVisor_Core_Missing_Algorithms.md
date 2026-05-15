# Impro-Visor 核心缺失算法源码提取

### File: src\imp\data\MelodyGenerator.java

```java

/**
 * This Java Class is part of the Impro-Visor Application.
 *
 * Copyright (C) 2015-2017 Robert Keller and Harvey Mudd College
 *
 * Impro-Visor is free software; you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation; either version 2 of the License, or (at your option) any later
 * version.
 *
 * Impro-Visor is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of merchantability or fitness
 * for a particular purpose. See the GNU General Public License for more
 * details.
 *
 * You should have received a copy of the GNU General Public License along with
 * Impro-Visor; if not, write to the Free Software Foundation, Inc., 51 Franklin
 * St, Fifth Floor, Boston, MA 02110-1301 USA
 */

package imp.data;
import imp.Constants;
import static imp.Constants.OCTAVE;
import imp.com.RectifyPitchesCommand;
import imp.gui.Notate;
import imp.lickgen.Grammar;
import java.util.ArrayList;
import java.util.Random;
import polya.Polylist;
import polya.PolylistEnum;

/**
 *
 * @author Mikayla Konst 2015
 * A MelodyGenerator generates a melody based on transition probabilities
 * between intervals. It is constructed using an IntervalLearner.
 * 
 * Important Note about Pre-Rectification:
 * This class used to be capable of Pre-Rectification.
 * Pre-Rectification means only choosing among notes that are chord or color tones
 * each time that you choose a note to travel to.
 * This differs from Post-Rectification, in which you choose whatever notes you want
 * and then rectify them to chord/color/approach tones.
 * To reinstate Pre-Rectification, alter the bestChoice functions to only choose from
 * chord and color tones in exactly the same way that they only choose from notes that are in range,
 * i.e. by only adding in-range, chord/color tones with non-zero probabilities to the list and then adjusting the probabilities.
 * If no notes meet this criteria, allow non-chord/color tones. If still no notes meet this criteria,
 * allow out-of-range notes.
 */
public class MelodyGenerator {

    //Instance Variables
    
    //1st order probabilities
    private double [][] probabilities;
    //2nd order probabilities
    private double [][][] probabilities2;
    
    //The desired rhythm of the generated melody
    private MelodyPart rhythm;
    //The chords that the melody will be generated over
    private ChordPart chords;
    //The desired range of the generated melody
    private int [] range;
    //whether to rectify
    private boolean rectify;
    //types of notes to allow in rectification
    private boolean includeChord, includeColor, includeApproach;
    //whether to merge same notes
    private boolean merge;

    //Constants
    
    //used to denote no knowledge of which interval we're coming from
    private static final int NO_DATA = Integer.MAX_VALUE;
    //constant indicating in range
    private static final boolean IN_RANGE = true;
    
    //Constructors
    
    /**
     * MelodyGenerator
     * Constructs a MelodyGenerator given a MelodyPart containing the desired rhythm.
     * @param learner an IntervalLearner
     * @param rhythm a MelodyPart that represents the desired rhythm
     * @param chords the ChordPart that the melody will be generated over
     * @param range the desired range of the melody
     * @param merge whether to merge adjacent same notes
     * @param rectify whether to rectify
     * @param include array of three booleans representing whether to include chord, color, approach in rectification
     */
    public MelodyGenerator(IntervalLearner learner, MelodyPart rhythm, ChordPart chords, int [] range, boolean merge, boolean rectify, boolean [] include){
        probabilities = learner.getDeg1Probs();
        probabilities2 = learner.getDeg2Probs();
        this.rhythm = rhythm;
        this.chords = chords;
        this.range = range;
        this.merge = merge;
        this.rectify = rectify;
        this.includeChord = include[0]; this.includeColor = include[1]; this.includeApproach = include[2];
    }
    
    /**
     * MelodyGenerator
     * Constructs a MelodyGenerator using a Notate to generate a grammar-based rhythm
     * @param learner an IntervalLearner
     * @param notate a Notate whose selected grammar will be used to generate a rhythm
     * @param chords the ChordPart that the melody will be generated over
     * @param range the desired range of the melody
     * @param merge whether to merge adjacent same notes
     * @param rectify whether to rectify
     * @param include array of three booleans representing whether to include chord, color, approach in rectification
     */
    public MelodyGenerator(IntervalLearner learner, Notate notate, ChordPart chords, int [] range, boolean merge, boolean rectify, boolean [] include){
        this(learner, polylistToMelodyPart(rhythm(notate)), chords, range, merge, rectify, include);
    }
    
    //Rhythm Utility Methods
    
    /**
     * rhythm
     * Creates a rhythm Polylist from an instance of Notate
     * @param notate Notate whose selected Grammar will be used in rhythm generation
     * @return a Polylist representing a rhythm
     */
    public static Polylist rhythm(Notate notate){
        Grammar gram = new Grammar(notate.getGrammarFileName());
        return justRhythm(gram.run(0, notate.getScoreLength(), notate, false, false, -1));
    }

    /**
     * justRhythm
     * Extracts just a rhythm from an abstract Melody
     * This method should probably live somewhere else so that other people
     * can use it as well.
     * @param abstractMelody - an abstract melody that is to be reduced to just a rhythm.
     * @return just a rhythm (as a Polylist)
     */
    private static Polylist justRhythm(Polylist abstractMelody){
        PolylistEnum iterator = abstractMelody.elements();
        Polylist justRhythm = new Polylist();
        while(iterator.hasMoreElements()){
            Object nextElem = iterator.nextElement();
            try{
                Polylist note = (Polylist)nextElem;
                if(note.first().toString().equals("triadic")){
                    int totalDur = Duration.getDuration(note.second().toString());
                    int smallDur = Duration.getDuration(note.third().toString());
                    int numberOfNotes = totalDur/smallDur;
                    for(int i = 0; i<numberOfNotes; i++){
                        justRhythm = justRhythm.addToEnd("X"+note.third().toString());
                    }
                }else{
                    PolylistEnum i = note.elements();
                    while(i.hasMoreElements()){
                        try{
                            String elem = i.nextElement().toString();
                            if(elem.matches("[A-Z].*")){
                                if(elem.charAt(0)=='R'){
                                    justRhythm = justRhythm.addToEnd(elem);
                                }else{
                                    justRhythm = justRhythm.addToEnd("X"+elem.substring(1));
                                }
                            }
                        }catch(Exception e){

                        }
                    }
                }
                
            }catch(Exception ex){
                try{
                    String elem = nextElem.toString();
                    if(elem.matches("[A-Z].*")){
                        if(elem.charAt(0)=='R'){
                            justRhythm = justRhythm.addToEnd(elem);
                        }else{
                            justRhythm = justRhythm.addToEnd("X"+elem.substring(1));
                        }
                    }
                }catch(Exception exp){
                    
                }
            }
        }
        return justRhythm;
    }
    
    /**
     * polylistToMelodyPart
     * Converts a Polylist containing just a rhythm to a MelodyPart
     * containing rests and notes.
     * @param rhythm a Polylist containing a rhythm
     * @return a MelodyPart containing a C for every note in the rhythm
     * and a rest for every rest.
     */
    public static MelodyPart polylistToMelodyPart(Polylist rhythm){
        MelodyPart result = new MelodyPart();
        PolylistEnum iterator = rhythm.elements();
        while(iterator.hasMoreElements()){
            String s = (String)iterator.nextElement();
            char restOrNote = s.charAt(0);
            String RorX = Character.toString(restOrNote);
            
            int duration = Duration.getDuration(s.substring(1));
            
            Note n;
            if(RorX.equals("R")){
                n = new Rest(duration);
            }else{//N, C, L, A, X, S
                n = new Note(Constants.C4, duration);
            }
            result.addNote(n);
        }
        return result;
    }

    //Melody Generation Functions
    
    /**
     * melody
     * @return a MelodyPart based on a 1st order Markov Chain
     */
    public MelodyPart melody() {
        MelodyPart result = new MelodyPart();
        int prevInterval = NO_DATA;
        Note prevNote = null; //always a note, never a rest
        int slot = 0;
        Note n = rhythm.getNote(slot);
        int duration = n.getRhythmValue();
        Chord chord = chords.getCurrentChord(slot);

        while(slot < rhythm.size()){
            Note toAdd;
            
            if(n.isRest()){
                toAdd = n.copy();
            }
            //should only be true for first note
            else if(prevNote == null){
                toAdd = randomChordOrColorTone(chord, duration);
                prevInterval = NO_DATA;
                
            //should only be true for second note (we ignore rests)
            }else if(prevInterval == NO_DATA){
                toAdd = randomChordOrColorTone(chord, duration);
                prevInterval = toAdd.getPitch() - prevNote.getPitch();
            }
            else{
                toAdd = bestChoice(prevInterval, prevNote, duration);
                prevInterval = toAdd.getPitch() - prevNote.getPitch();
            }
            
            //if n is a rest, skip right over it like it was never there
            if(!n.isRest()){
               prevNote = toAdd; 
            }
            
            result.addNote(toAdd);
            
            slot += duration;
            if(slot < rhythm.size()){
                n = rhythm.getNote(slot);
                duration = n.getRhythmValue();
                chord = chords.getCurrentChord(slot);
            }

            
        }
        if(rectify){
            //post-rectification to chord, color, and approach tones
            RectifyPitchesCommand cmd = 
                    new RectifyPitchesCommand(result, 
                                              0,
                                              result.size()-1, 
                                              chords,
                                              false, 
                                              false,
                                              includeChord, 
                                              includeColor, 
                                              includeApproach,
                                              merge);
            cmd.execute();
        }
        //merge same notes - good idea???
        if(merge){
            result.removeRepeatedNotesInPlace();
        }
        return result;
    }
    
    
    /**
     * melody2
     * @return a MelodyPart based on a 2nd order Markov Chain
     */
    public MelodyPart melody2() {
        MelodyPart result = new MelodyPart();
        int prevInterval1 = NO_DATA;
        int prevInterval2 = NO_DATA;
        Note prevNote = null; //always a note, never a rest
        int slot = 0;
        Note n = rhythm.getNote(slot);
        int duration = n.getRhythmValue();
        Chord chord = chords.getCurrentChord(slot);

        while(slot < rhythm.size()){
            Note toAdd;
            
            if(n.isRest()){
                toAdd = n.copy();
            }
            //should only be true for first note
            else if(prevNote == null){
                toAdd = randomChordOrColorTone(chord, duration);
                
            //should only be true for second note (we ignore rests)
            }else if(prevInterval1 == NO_DATA){
                toAdd = randomChordOrColorTone(chord, duration);
                prevInterval1 = toAdd.getPitch() - prevNote.getPitch();
            //should only be true for third note
            }else if(prevInterval2 == NO_DATA){
                toAdd = randomChordOrColorTone(chord, duration);
                prevInterval2 = toAdd.getPitch() - prevNote.getPitch();
            }
            else{
                toAdd = bestChoice(prevInterval1, prevInterval2, prevNote, duration, chord);
                prevInterval1 = prevInterval2;
                prevInterval2 = toAdd.getPitch() - prevNote.getPitch();
            }
            
            //if n is a rest, skip right over it like it was never there
            if(!n.isRest()){
               prevNote = toAdd; 
            }
            
            result.addNote(toAdd);
            
            slot += duration;
            if(slot < rhythm.size()){
                n = rhythm.getNote(slot);
                duration = n.getRhythmValue();
                chord = chords.getCurrentChord(slot);
            }

            
        }
        if(rectify){
            //post-rectification to chord, color, and approach tones
            RectifyPitchesCommand cmd = 
                    new RectifyPitchesCommand(result, 
                                              0,
                                              result.size()-1, 
                                              chords,
                                              false, 
                                              false,
                                              includeChord, 
                                              includeColor, 
                                              includeApproach,
                                              merge);
            cmd.execute();
        }
        //merge same notes - good idea???
        if(merge){
            result.removeRepeatedNotesInPlace();
        }
        return result;
    }    
    
//    //Merge Same Notes
//    
//    /**
//     * mergeSameNotes
//     * Merges consecutive notes that have the same pitch.
//     * This should probably be a command so that more people can use it.
//     * @param unmerged a MelodyPart whose consecutive same notes are to be merged.
//     * @return a MelodyPart whose consecutive same notes have been merged.
//     */
//    private MelodyPart mergeSameNotes(MelodyPart unmerged){
//        MelodyPart merged = new MelodyPart();
//        int duration = unmerged.getNote(0).getRhythmValue();
//        Note toAdd = unmerged.getNote(0);
//        int lastIndex = unmerged.getLastActiveSlot();
//        for(int i = 0; i + duration <= lastIndex; i += duration){
//            
//            Note curr = unmerged.getNote(i);
//            duration = curr.getRhythmValue();
//            Note next = unmerged.getNote(i + duration);
//            try{
//                if(curr.getPitch() == next.getPitch()){
//                    toAdd.setRhythmValue(toAdd.getRhythmValue() + next.getRhythmValue());
//                }else{
//                    merged.addNote(toAdd.copy());
//                    toAdd = next;
//                }
//            }catch(Exception e){
//                System.out.println("Something went wrong. Info below:");
//                System.out.println("i: "+i);
//                System.out.println("duration: "+duration);
//                System.out.println("curr: "+curr);
//                System.out.println("next: "+next);
//            }
//            
//        }
//        //add the last note
//        merged.addNote(toAdd);
//        return merged;
//    }
    
    //Utilities for choosing the first 2-3 notes of a melody:
    
    /**
     * middleOfRange
     * returns the midi value located at the middle of the range
     * (rounds down)
     * @return midi value of middle of range
     */
    private int middleOfRange(){
        return range[0]+((range[1]-range[0])/2);//rounds down for odd numbers
    }
    
    /**
     * inRange
     * Tests if a pitch is in range (being at a range limit is okay)
     * @param pitchToAdd pitch to check
     * @return true if in range, false otherwise
     */
    private boolean inRange(int pitchToAdd) {
        return pitchToAdd >= range[0] && pitchToAdd <= range[1];
    }
 
    
    /**
     * closestToMiddle
     * Returns the version of note n that is closest to the middle of the range
     * Below the middle if ascending, above is descending, closest if no pref
     * @param n Note
     * @param line line
     * @return version of note closest to middle of range
     */
    private Note closestToMiddle(Note n){
        
        int rv = n.getRhythmValue();
        
        int closestBelow = closestBelowMiddle(n);
        boolean belowInRange = inRange(closestBelow)==IN_RANGE;
        int closestAbove = closestAboveMiddle(n);
        boolean aboveInRange = inRange(closestAbove)==IN_RANGE;
        
        int pitch;

        if(belowInRange && aboveInRange){
            int middle = middleOfRange();
            //closest of the two - tiebreak goes to above note if distances equal
            pitch = ((middle-closestBelow)<(closestAbove-middle)?closestBelow:closestAbove);
        }else if(belowInRange){
            pitch = closestBelow;
        }else{//above guaranteed to be in range because we limit the user to an octave
            pitch = closestAbove;
        }

        return new Note(pitch, rv);
    }
    
    /**
     * closestBelowMiddle
     * Returns version of note n that is in the octave below the middle of range
     * @param n note
     * @return version of note in octave below middle of range
     */
    private int closestBelowMiddle(Note n){
        int notePitch = n.getPitch();
        int middle = middleOfRange();
        int pitch;
        for(pitch = middle; !samePitchClass(pitch, notePitch); pitch--){
                
        }
        return pitch;
    }
    
    /**
     * closestAboveMiddle
     * Returns version of note n that is in the octave above the middle of range
     * @param n note
     * @return version of note in octave above middle of range
     */
    private int closestAboveMiddle(Note n){
        int notePitch = n.getPitch();
        int middle = middleOfRange();
        int pitch;
        for(pitch = middle; !samePitchClass(pitch, notePitch); pitch++){
                
        }
        return pitch;
    }
    
    //problems if you pass in a negative pitch...
    /**
     * samePitchClass
     * Returns whether two pitches have the same pitch class
     * @param pitch1 first pitch
     * @param pitch2 second pitch
     * @return true if pitches have the same pitch class, false otherwise
     */
    private boolean samePitchClass(int pitch1, int pitch2){
        return getMod(pitch1) == getMod(pitch2);
    }
    
    /**
     * getMod
     * returns an int representing the pitch class of the midi value
     * (0 for C, ... , 11 for B)
     * @param midi midivalue
     * @return int representing a midi value's pitch class
     */
    private int getMod(int midi){
        return midi%OCTAVE;
    }
    
    /**
     * randomChordOrColorTone
     * Used to choose the first 2-3 notes of the generated solo.
     * @param chord - chord the note is to be played over
     * @param duration - duration desired
     * @return a note that is a random chord or color tone of the chord
     * and is close to the middle of the range
     */
    private Note randomChordOrColorTone(Chord chord, int duration){
        if(chord == null || chord.isNOCHORD()){
            return new Note(middleOfRange(), duration);
        }
        ArrayList<Note> chordAndColorTones = chordAndColorTones(chord, duration);
        int size = chordAndColorTones.size();
        Random r = new Random();
        int choice = r.nextInt(size);
        Note toReturn = chordAndColorTones.get(choice);
        return closestToMiddle(toReturn);
    }
    
     /**
     * chordTones
     * Returns an ArrayList of all the chord and color tones of a given chord
     * @param chord chord from which chord tones are to be extracted
     * @param duration duration that these notes are to have
     * @return ArrayList of chord tones - NOTE: default pitches used
     */
    private static ArrayList<Note> chordAndColorTones(Chord chord, int duration){
        PolylistEnum noteList = chord.getSpell().elements();
        ArrayList<Note> chordAndColorTones = new ArrayList<Note>();
        while(noteList.hasMoreElements()){
            Note note = ((NoteSymbol)noteList.nextElement()).toNote();
            note.setRhythmValue(duration);
            chordAndColorTones.add(note);
        }
        PolylistEnum colorList = chord.getColor().elements();
        while(colorList.hasMoreElements()){
            Note note = ((NoteSymbol)colorList.nextElement()).toNote();
            note.setRhythmValue(duration);
            chordAndColorTones.add(note);
        }
        return chordAndColorTones;
    }

    //Choosing the best note to come next:
    
    /**
     * bestChoice
     * @param prevInterval The interval you're coming from
     * @param prevNote The note you're coming from
     * @param duration The duration of the note you're going to
     * @param chord The chord the note you're going to will be played over
     * @return a good note to go to
     */
    private Note bestChoice(int prevInterval, Note prevNote, int duration) {
        int prevPitch = prevNote.getPitch();
        ArrayList<Integer> pitches = new ArrayList<Integer>();
        ArrayList<Double> pitchProbs = new ArrayList<Double>();
        
        //include only those notes that are in range and have nonzero probabilities
        int sourceIndex = intervalToIndex(prevInterval);
        for(int destIndex = 0; destIndex < probabilities[sourceIndex].length; destIndex ++){
            double prob = probabilities[sourceIndex][destIndex];
            int pitchToAdd = prevPitch + indexToInterval(destIndex);
            if(prob != 0 && inRange(pitchToAdd)){
                pitches.add(pitchToAdd);
                pitchProbs.add(prob);
            }
        }

        //if there are no intervals that have nonzero probability that are in range,
        //allow notes out of range
        if(pitchProbs.isEmpty()){
            for(int destIndex = 0; destIndex < probabilities[sourceIndex].length; destIndex ++){
                double prob = probabilities[sourceIndex][destIndex];
                int pitchToAdd = prevPitch + indexToInterval(destIndex);
                if(prob != 0){
                    pitches.add(pitchToAdd);
                    pitchProbs.add(prob);
                }
            }
        }
        
        //readjust probabilities so that they sum to one again
        //they might not sum to 1 anymore because we eliminated options that were out of range
        double total = 0;
        for(double prob : pitchProbs){
            total += prob;
        }
        for(int i = 0; i<pitchProbs.size(); i++){
            pitchProbs.set(i, pitchProbs.get(i)/total);
        }
        
        Random r = new Random();
        double decision = r.nextDouble();
        double totalProb = 0;
        
        //this'll be unaltered if for some reason the probabilites don't sum
        //exactly to 1 and the random number generator produce exactly 1 (unlikely)
        int bestPitch = pitches.get(0);
        
        for(int i = 0; i < pitchProbs.size(); i++){
            totalProb += pitchProbs.get(i);
            if(totalProb > decision){
                bestPitch = pitches.get(i);
                break;
            }
        }
        
        return new Note(bestPitch, duration);
    }
    
    /**
     * bestChoice
     * Uses 2nd order Markov Chain to find a good note to go to
     * @param prevInterval1 The first interval you're coming from
     * @param prevInterval2 The second interval you're coming from
     * @param prevNote The note you're coming from
     * @param duration The duration of the note you're going to
     * @param chord The chord the note you're going to will be played over
     * @return a good note to go to
     */
    private Note bestChoice(int prevInterval1, int prevInterval2, Note prevNote, int duration, Chord chord) {
        int prevPitch = prevNote.getPitch();
        ArrayList<Integer> pitches = new ArrayList<Integer>();
        ArrayList<Double> pitchProbs = new ArrayList<Double>();
        
        int x = intervalToIndex(prevInterval1);
        int y = intervalToIndex(prevInterval2);
        for(int z = 0; z < probabilities2[x][y].length; z ++){
            double prob = probabilities2[x][y][z];
            int pitchToAdd = prevPitch + indexToInterval(z);
            if(prob != 0 && inRange(pitchToAdd)){
                pitches.add(pitchToAdd);
                pitchProbs.add(prob);
            }
        }

        //if there are no intervals that have nonzero probability that are in range,
        //allow notes out of range
        if(pitchProbs.isEmpty()){
            for(int z = 0; z < probabilities2[x][y].length; z ++){
                double prob = probabilities2[x][y][z];
                int pitchToAdd = prevPitch + indexToInterval(z);
                if(prob != 0){
                    pitches.add(pitchToAdd);
                    pitchProbs.add(prob);
                }
            }
        }
        
        //readjust probabilities so that they sum to one again
        //they might not sum to 1 anymore because we eliminated options that were out of range
        double total = 0;
        for(double prob : pitchProbs){
            total += prob;
        }
        for(int i = 0; i<pitchProbs.size(); i++){
            pitchProbs.set(i, pitchProbs.get(i)/total);
        }
        
        Random r = new Random();
        double decision = r.nextDouble();
        double totalProb = 0;
        
        //this'll be unaltered if for some reason the probabilites don't sum
        //exactly to 1 and the random number generator produce exactly 1 (unlikely)
        int bestPitch = pitches.get(0);
        
        for(int i = 0; i < pitchProbs.size(); i++){
            totalProb += pitchProbs.get(i);
            if(totalProb > decision){
                bestPitch = pitches.get(i);
                break;
            }
        }
        
        return new Note(bestPitch, duration);
    }
    
    //Utilities:
    
    /**
     * intervalToIndex
     * Adds an Octave to convert an interval to its array index
     * @param interval directional interval from -12 to 12
     * @return its index (0 to 24)
     */
    private static int intervalToIndex(int interval){
        return interval + Constants.OCTAVE;
    }
    
    /**
     * indexToInterval
     * Subtracts an Octave to convert an index to its interval
     * @param index array index from 0 to 24
     * @return a directional interval from -12 to 12
     */
    private static int indexToInterval(int index){
        return index - Constants.OCTAVE;
    }

}

```

### File: src\imp\data\IntervalLearner.java

```java

/**
 * This Java Class is part of the Impro-Visor Application.
 *
 * Copyright (C) 2015-2017 Robert Keller and Harvey Mudd College
 *
 * Impro-Visor is free software; you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation; either version 2 of the License, or (at your option) any later
 * version.
 *
 * Impro-Visor is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of merchantability or fitness
 * for a particular purpose. See the GNU General Public License for more
 * details.
 *
 * You should have received a copy of the GNU General Public License along with
 * Impro-Visor; if not, write to the Free Software Foundation, Inc., 51 Franklin
 * St, Fifth Floor, Boston, MA 02110-1301 USA
 */

package imp.data;

import imp.Constants;
import java.io.File;
import java.io.FileNotFoundException;
import java.util.ArrayList;
import java.util.LinkedList;
import java.util.Random;
import java.util.Scanner;

/**
 *
 * @author Mikayla Konst 2015
 * An IntervalLearner learns transition probabilities between intervals.
 * It can learn both 1st and 2nd order Markov Chains.
 */
public final class IntervalLearner {
    
    //1st Order Markov Chains
    
    private final int [][] deg1Counts;        //counts
    private final double [][] deg1Probs;      //probabilities
    private final int [] deg1Totals;          //row totals (for calculating probabilities)
    
    //2nd Order Markov Chains
    
    private final int [][][] deg2Counts;      //counts
    private final double [][][] deg2Probs;    //probabilities
    private final int [][] deg2Totals;        //row totals (for calculating probabilities)
    
    //Constants
    
    private static final int range = Constants.OCTAVE;  //limit intervals learned from to +/- an octave
    public static final int intervals = 2*range+1;      //# of unique directional intervals (-12, -11, ... , 0 , ... , 11, 12)
    private static final int ONE = 1;                   //many times we need to just add 1 to a running total
    
    /**
     * IntervalLearner
     * Constructor
     * Initializes counts, row totals, and probabilities to zero.
     */
    public IntervalLearner(){
        deg1Counts = new int[intervals][intervals];
        deg2Counts = new int[intervals][intervals][intervals];
        deg1Probs = new double[intervals][intervals];
        deg2Probs = new double[intervals][intervals][intervals];
        deg1Totals = new int[intervals];
        deg2Totals = new int[intervals][intervals];
        clearAll();
    }

    //Public Methods:
    
    //Accessors:
    
    /**
     * getDeg1Counts
     * @return 1st order counts
     */
    public int [][] getDeg1Counts(){
        return deg1Counts;
    }
    
    /**
     * getDeg2Counts
     * @return 2nd order counts
     */
    public int [][][] getDeg2Counts(){
        return deg2Counts;
    }
    
    /**
     * getCountsCrossSection
     * Returns a 2D array that is a cross section of the complete 3D transition matrix.
     * @param interval - source interval #1
     * @return Cross section corresponding to that source interval
     */
    public int [][] getCountsCrossSection(int interval){
        return deg2Counts[intervalToIndex(interval)];
    }
    
    /**
     * getDeg1Probs
     * @return 1st order probabilities
     */
    public double [][] getDeg1Probs(){
        return deg1Probs;
    }
    
    /**
     * getDeg2Probs
     * @return 2nd order probabilities
     */
    public double [][][] getDeg2Probs(){
        return deg2Probs;
    }
    
    /**
     * getProbsCrossSection
     * Returns a 2D array that is a cross section of the complete 3D transition matrix.
     * @param interval - source interval #1
     * @return Cross section corresponding to that source interval
     */    
    public double [][] getProbsCrossSection(int interval){
        return deg2Probs[intervalToIndex(interval)];
    }
    
    //Learning Operations:
    
    /**
     * clearAll
     * Clears all counts, row totals, and probabilities by zeroing them out
     * Use this before learning if you want to start from a clean slate
     * (Learning is cumulative by default)
     */
    public void clearAll(){
        zeroCounts();
        updateProbs();
    }
    
    /**
     * learnFrom
     * Learn transition probabilities from a melody
     * NOTE: learning is cumulative by default.
     * If you do NOT want to add the counts learned to the running total,
     * please call clearAll first to start from a clean slate.
     * @param melody - melody to be learned from
     */
    public void learnFrom(MelodyPart melody){
        
        if(melody == null){
            return;
        }
        
        //make list of just notes (no rests)
        ArrayList<Note> notes = new ArrayList<Note>();
        for(Note n : melody.getNoteList()){
            if(!n.isRest()){
                notes.add(n);
            }
        }
        
        //add to 1st order counts
        for(int i = 0; i<notes.size()-2; i++){//stop at third note from end
            int first = notes.get(i).getPitch();
            int second = notes.get(i+1).getPitch();
            int third = notes.get(i+2).getPitch();
            
            int src = second-first;
            int dest = third-second;
            
            if(inRange(src) && inRange(dest)){
                addCount(intervalToIndex(src), intervalToIndex(dest));
            }
        }
        
        //update 1st order probs
        updateDeg1Probs();
        
        //add to 2nd order counts
        for(int i = 0; i<notes.size()-3; i++){//stop at fourth note from end
            int first = notes.get(i).getPitch();
            int second = notes.get(i+1).getPitch();
            int third = notes.get(i+2).getPitch();
            int fourth = notes.get(i+3).getPitch();
            
            int x = second-first;
            int y = third-second;
            int z = fourth-third;
            
            if(inRange(x) && inRange(y) && inRange(z)){
                addCount(intervalToIndex(x), intervalToIndex(y), intervalToIndex(z));
            }
        }
        
        //update 2nd order probs
        updateDeg2Probs();
    }
    
    /**
     * learnFrom
     * Learn transition probabilities from multiple melodies
     * NOTE: learning is cumulative by default.
     * If you do NOT want to add the counts learned to the running total,
     * please call clearAll first to start from a clean slate.
     * @param melodies - melodies to be learned from
     */
    public void learnFrom(ArrayList<MelodyPart> melodies){
        for(MelodyPart m : melodies){
            learnFrom(m);
        }
    }
    
    /**
     * learnFrom
     * Learns transition probabilities from a file.
     * NOTE: learning is cumulative by default.
     * If you do NOT want to add the counts learned to the running total,
     * please call clearAll first to start from a clean slate.
     * @param f - file to be learned from
     * @throws FileNotFoundException 
     */
    public void learnFrom(File f) throws FileNotFoundException{
        Scanner scan = new Scanner(f);
        //add to 1st order counts
        for(int row = 0; row < deg1Counts.length; row++){
            for(int column = 0; column < deg1Counts[row].length; column++){
                addCounts(scan.nextInt(), row, column);
            }
        }
        //add to 2nd order counts
        for(int x = 0; x < deg2Counts.length; x++){
            for(int y = 0; y < deg2Counts[x].length; y++){
                for(int z = 0; z < deg2Counts[x][y].length; z++){
                    addCounts(scan.nextInt(), x, y, z);
                }
            }
        }
        scan.close();
        updateProbs();
    }
    
    //Private Methods:
    
    //Zeroing Counts:
    
    /**
     * zeroCounts
     * Makes all counts zero
     * (Also zeros out row totals)
     */
    private void zeroCounts(){
        zeroDeg1Counts();
        zeroDeg2Counts();
    }
    
    /**
     * zeroDeg1Counts
     * zeros out 1st order counts and row totals
     */
    private void zeroDeg1Counts(){
        for(int row = 0; row < deg1Counts.length; row++){
            for(int column = 0; column < deg1Counts[row].length; column++){
                deg1Counts[row][column] = 0;
            }
            deg1Totals[row] = 0;
        }
    }
    
    /**
     * zeroDeg2Counts
     * zeros out 2nd order counts and row totals
     */
    private void zeroDeg2Counts(){
        for(int x = 0; x < deg2Counts.length; x++){
            for(int y = 0; y < deg2Counts[x].length; y++){
                for(int z = 0; z < deg2Counts[x][y].length; z++){
                    deg2Counts[x][y][z] = 0;
                }
                deg2Totals[x][y] = 0;
            }
        }
    }
    
    //Adding to Counts:
    
    /**
     * addCount
     * Add 1 to the count located at row, column in deg1Counts
     * (also updates row totals)
     * @param row - row of count to be added to
     * @param column - column of count to be added to
     */
    private void addCount(int row, int column){
        addCounts(ONE, row, column);
    }
    
    /**
     * Add 1 to the count located at x, y, z in deg2Counts
     * (also updates row totals)
     * @param x - 1st coordinate of count to be added to
     * @param y - 2nd coordinate of count to be added to
     * @param z - 3rd coordinate of count to be added to
     */
    private void addCount(int x, int y, int z){
        addCounts(ONE, x, y, z);
    }
    
    /**
     * addCounts
     * Add a number to the current count stored at row, column in deg1Counts
     * (also update the row total)
     * @param number - number to add
     * @param row - row where count is located
     * @param column - column where count is located
     */
    private void addCounts(int number, int row, int column) {
        deg1Counts[row][column] += number;
        deg1Totals[row] += number;
    }
    
    /**
     * addCounts
     * Add a number to the current count stored at row, column in deg2Counts
     * @param number - number to add
     * @param x - x coordinate of count
     * @param y - y coordinate of count
     * @param z - z coordinate of count
     */
    private void addCounts(int number, int x, int y, int z){
        deg2Counts[x][y][z] += number;
        deg2Totals[x][y] += number;
    }
    
    //Updating Probabilities:
    
    /**
     * updateProbs
     * update probability matrices based on row totals
     */
    private void updateProbs(){
        updateDeg1Probs();
        updateDeg2Probs();
    }

    /**
     * updateDeg1Probs
     * Update the 2st order probabilities based on counts and row totals.
     */
    private void updateDeg1Probs(){

        //fill probability table
        for(int row = 0; row < deg1Counts.length; row++){
            int denominator = deg1Totals[row];
            if(denominator!=0){
                //assign probabilities based on counts
                for(int cell = 0; cell < deg1Counts[row].length; cell++){
                    deg1Probs[row][cell] = (double)deg1Counts[row][cell]/(double)denominator;
                }
            }
            else{
                //no data: make all destination intervals equally likely
                for(int cell = 0; cell < deg1Counts[row].length; cell++){
                    deg1Probs[row][cell] = 1.0/(double)deg1Counts[row].length;
                }
            }
        }
    }
    
    /**
     * updateDeg2Probs
     * Update the 2nd order probabilities based on counts and row totals.
     */
    private void updateDeg2Probs(){
        for(int x = 0; x < deg2Probs.length; x++){
            for(int y = 0; y < deg2Probs[x].length; y++){
                int denominator = deg2Totals[x][y];
                if(denominator != 0){
                    for(int z = 0; z < deg2Counts[x][y].length; z++){
                        deg2Probs[x][y][z] = (double)deg2Counts[x][y][z] / (double)denominator;
                    }
                }else{
                    //no data: make all destination intervals equally likely
                    for(int z = 0; z < deg2Counts[x][y].length; z++){
                        deg2Probs[x][y][z] = 1.0/(double)intervals;
                    }
                }
            }
        }
    }

    //Utilities:
    
    /**
     * inRange
     * Tells whether an interval is within the range of intervals we can learn from.
     * @param interval - interval to be tested
     * @return true if the interval is within the range, false otherwise
     */
    private boolean inRange(int interval){
        return Math.abs(interval) <= range;
    }
    
    /**
     * indexToInterval
     * Converts an array index to an interval by subtracting range
     * @param index
     * @return 
     */
    private static int indexToInterval(int index){
        return index - range;
    }
    
    /**
     * intervalToIndex
     * Converts a directional interval to an array index by adding range
     * @param interval - interval to be converted
     * @return corresponding array index
     */
    private static int intervalToIndex(int interval){
        return interval + range;
    }
    
    //Best Pitch methods (For use in Trading):
    
    /**
     * bestPitch
     * Finds a likely pitch to go to next given a list of notes
     * If the note list is less than 2 elements, return 0.
     * If the note list is two elements long, return a pitch given by the 1st order Markov Chain.
     * If the note list is at least three elements long, return a pitch given by the 2nd order Markov Chain.
     * @param notes - list of notes
     * @return likely pitch to go to next
     */
    public int bestPitch(LinkedList<Integer> notes){
        if (notes.size() < 2){
            return 0;
        } else if (notes.size() > 2){
            int note3 = notes.removeLast();
            int note2 = notes.removeLast();
            int note1 = notes.removeLast();
            return bestPitch((note3 - note2), (note2 - note1), note3);
        } else {
            int note2 = notes.removeLast();
            int note1 = notes.removeLast();
            return bestPitch((note2 - note1), note2);
        }
    }

    /**
     * best pitch
     * Returns the best pitch to go to next based on a 1st order Markov Chain
     * @param prevInterval - interval we're coming from
     * @param prevPitch - pitch we're coming from
     * @return best pitch to travel to next
     */
    public int bestPitch(int prevInterval, int prevPitch){
        ArrayList<Integer> pitches = new ArrayList<Integer>();
        ArrayList<Double> pitchProbs = new ArrayList<Double>();
        
        int sourceIndex = intervalToIndex(prevInterval);
        for(int destIndex = 0; destIndex < deg1Probs[sourceIndex].length; destIndex ++){
            double prob = deg1Probs[sourceIndex][destIndex];
            int pitchToAdd = prevPitch + indexToInterval(destIndex);
            if(prob != 0){
                pitches.add(pitchToAdd);
                pitchProbs.add(prob);
            }
        }

        Random r = new Random();
        double decision = r.nextDouble();
        double totalProb = 0;
        
        int bestPitch = pitches.get(0);
        
        for(int i = 0; i < pitchProbs.size(); i++){
            totalProb += pitchProbs.get(i);
            if(totalProb > decision){
                bestPitch = pitches.get(i);
                break;
            }
        }
        
        return bestPitch;
    }
    
    /**
     * best Pitch
     * Returns the best pitch to go to next based on a 2nd order Markov Chain
     * @param prevInterval1 - source interval #1
     * @param prevInterval2 - source interval #2
     * @param prevPitch - pitch we're coming from
     * @return best pitch to travel to next
     */
    public int bestPitch(int prevInterval1, int prevInterval2, int prevPitch){
        ArrayList<Integer> pitches = new ArrayList<Integer>();
        ArrayList<Double> pitchProbs = new ArrayList<Double>();
        
        int x = intervalToIndex(prevInterval1);
        int y = intervalToIndex(prevInterval2);
        for(int z = 0; z < deg2Probs[x][y].length; z ++){
            double prob = deg2Probs[x][y][z];
            int pitchToAdd = prevPitch + indexToInterval(z);
            if(prob != 0){
                pitches.add(pitchToAdd);
                pitchProbs.add(prob);
            }
        }
        
        Random r = new Random();
        double decision = r.nextDouble();
        double totalProb = 0;
        
        int bestPitch = pitches.get(0);
        
        for(int i = 0; i < pitchProbs.size(); i++){
            totalProb += pitchProbs.get(i);
            if(totalProb > decision){
                bestPitch = pitches.get(i);
                break;
            }
        }
        
        return bestPitch;
    }
    
}

```

### File: src\imp\com\ShiftPitchesCommand.java

```java

/**
 * This Java Class is part of the Impro-Visor Application
 *
 * Copyright (C) 2005-2014 Robert Keller and Harvey Mudd College
 *
 * Impro-Visor is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * Impro-Visor is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * merchantability or fitness for a particular purpose.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Impro-Visor; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 */

package imp.com;

import imp.*;
import imp.data.*;
import imp.util.Trace;
import imp.util.ErrorLog;

/**
 * An undoable Command that can shift a contiguous set of pitches up or down
 * a specified amount.
 * @see         Command
 * @see         CommandManager
 * @see         Note
 * @see         MelodyPart
 * @author      Stephen Jones, Steven Gomez
 */
public class ShiftPitchesCommand implements Command, Constants {
    
    /**
     * the first slot to shift
     */
    int startIndex;
    
    /**
     * the last slot to shift
     */
    int stopIndex;
    
    /**
     * the amount to shift the pitch
     */
    int shift;
    
    /**
     * the minimum allowed pitch
     */
    int minPitch;
    
    /**
     * the maximum allowed pitch
     */
    int maxPitch;
    
    /**
     * the key signature of the part containing the note
     */
    int keySig;
    
    /**
     * the part in which to shift pitches
     */
    MelodyPart part;
    
    /**
     * true since this Command can be undone
     */
    boolean undoable = true;
    
    /**
     * Creates a new Command that can shift pitches of a set of Notes.
     */
    public ShiftPitchesCommand(int shift, MelodyPart part, int startIndex,
            int stopIndex, int minPitch, int maxPitch,
            int keySig) {
        this.startIndex = startIndex;
        this.part = part;
        this.stopIndex = stopIndex;
        this.shift = shift;
        this.minPitch = minPitch;
        this.maxPitch = maxPitch;
        this.keySig = keySig;
    }
    
    /**
     * Executes the shifts.
     */
    public void execute() {
        Trace.log(2, "executing ShiftPitchesCommand");
        
        doShift(shift);
        
//        if( ImproVisor.getPlay() ) {
//        ImproVisor.playCurrentSelection(false, 0, PlayScoreCommand.NODRUMS);
//            How it used to be: No chords were played.
//            new PlayPartCommand(((MelodyPart)part).extract(startIndex, stopIndex)).execute();
//        }
    }
    
    /**
     * Moves all selected notes one semitone in the given direction.  Undos
     * this change is the shift pushed a note out of bounds.
     */
    private void doShift(int shift) {
        boolean outOfBounds = false;
        try {          
            for(int i = startIndex; i <= stopIndex; i++) {
                Note note = part.getNote(i);
                if(note != null && note.nonRest()) {
                    note.shiftPitch(shift, keySig);

                    if(note.getPitch() < minPitch || note.getPitch() > maxPitch) 
                        outOfBounds = true;
                    
                }
            }
            
            /**
             * If that shift pushed any note/s out of bounds, shift it all back
             * the other direction.  We only have to do this once, since no note
             * can be out of bounds by more than one semitone (since 
             * the invariant is that all notes are in bounds, and we shift 
             * by one semitone).*/   
            if (outOfBounds) {
                for (int i = startIndex; i <= stopIndex; i++) {
                    Note note = part.getNote(i);
                    if(note != null && note.nonRest())
                        note.shiftPitch(-1*shift, keySig);
                }
            }
            
        } catch (Exception ex) {
            ErrorLog.log(ErrorLog.WARNING, "*** Warning: shift pitches failed.");
        }
    }
    
    /**
     * Undoes the shifts.
     */
    public void undo() {
        shift *= -1;
        execute();
    }
    
    /**
     * Redoes the shifts.
     */
    public void redo() {
        undo();
    }
    
    public boolean isUndoable() {
        return undoable;
    }
}

```

### File: src\imp\com\RectifyPitchesCommand.java

```java

/**
 * This Java Class is part of the Impro-Visor Application
 *
 * Copyright (C) 2005-2014 Robert Keller and Harvey Mudd College
 *
 * Impro-Visor is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * Impro-Visor is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * merchantability or fitness for a particular purpose.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Impro-Visor; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 */
package imp.com;

import imp.*;
import imp.data.*;
import polya.*;

/**
 * An undoable Command that can match a contiguous set of pitches to the
 * chord and scale tones played over the melody part.
 * @see         Command
 * @see         CommandManager
 * @see         Note
 * @see         MelodyPart
 * @author      Steven Gomez
 */
public class RectifyPitchesCommand
        implements Command, Constants
  {
  /**
   * the first slot to resolve
   */
  int startIndex;

  /**
   * the last slot to resolve
   */
  int stopIndex;

  /**
   * the part in which to resolve pitches
   */
  MelodyPart part;


  /**
   * the part before changes are made (for undo)
   */
  Part originalPart;

 /**
   * the new part, in case redo is called for
   */
  Part saveForRedo;

  /**
   * the chord progression to be played with the melody part
   */
  ChordPart chordProg;

  /**
   * false since this Command can not be undone
   */
  boolean undoable = true;

  boolean directional = false;

  boolean direction = true;
  
  boolean chordTones = true;
  
  boolean colorTones = true;
  
  boolean approachTones = true;
  
  boolean mergeRepeatedPitches = true;

  /**
   * Creates a new Command that can resolve pitches of a set of Notes.
   */
  public RectifyPitchesCommand(MelodyPart part, int startIndex,
                                int stopIndex, ChordPart chordProg,
                                boolean directional, boolean direction)
    {
    this.startIndex = startIndex;
    this.part = part;
    this.stopIndex = stopIndex;
    this.chordProg = chordProg;
    this.directional = directional; // whether specific direction is preferred
    this.direction = direction;     // preferred direction  (true = up)
    }
  
  public RectifyPitchesCommand(MelodyPart part, 
                              int startIndex,
                              int stopIndex, 
                              ChordPart chordProg,
                              boolean directional, 
                              boolean direction,
                              boolean chord, 
                              boolean color, 
                              boolean approach,
                              boolean mergeRepeatedPitches)
    {
      this(part, startIndex, stopIndex, chordProg, directional, direction);
      this.chordTones = chord;
      this.colorTones = color;
      this.approachTones = approach;
      this.mergeRepeatedPitches = mergeRepeatedPitches;
  }

/**
 * Executes the resolutions.
 */
public void execute()
  {
      //System.out.println("*******Rectifying Pitches*******");
      if(!(chordTones||colorTones)){
          //Invalid input. Include all.
          chordTones = true;
          colorTones = true;
          approachTones = true;
      }
      
      //int lastActiveSlot = part.getLastActiveSlot();
    //Trace.log(2, "executing RectifyPitchesCommand");

    //Was used to prevent two of the same note in a row
    //Note previousNote = null;
    //Note previouslyResolved = null;
    //int previousIndex = 0;

    // reserve for possible undo:
    originalPart = part.extractSlots(startIndex, stopIndex);


    int slotsRemaining = stopIndex - startIndex + 1;

    try
      {
        //for( int i = startIndex; i < stopIndex; i++ )
          for(int i = startIndex; i < stopIndex; i = part.getNextIndex(i))
          {
            Note currentNote = part.getNote(i);
            Note resolved = currentNote;
            
            if( currentNote != null )
              {
               //System.out.println("part at " + i + " had " + part.getNote(i));

               //int value = Math.min(currentNote.getRhythmValue(), slotsRemaining);
               int value = currentNote.getRhythmValue();

                if( currentNote.isRest() )
                  {
                      //was used to disallow repeated notes
                    //previouslyResolved = null;
                  }
                else
                  {
                    //System.out.println("Not a rest");
                    Chord chord = chordProg.getCurrentChord(i);
                    
                    //nextChord - for use in determing appraoch tones
                    Chord nextChord = null;
                    int nextIndex = part.getNextIndex(i);
                    if(nextIndex <= part.getLastActiveSlot()){
                        nextChord = chordProg.getCurrentChord(nextIndex);
                    }
                    
                    if( chord.isNOCHORD() )
                      {
                      // leave currentNote as resolved
                      }
                    else
                      {
                        //System.out.println("Not isNOCHORD");
                        ChordForm form = chord.getChordSymbol().getChordForm();
                        String root = chord.getRoot();
                        //System.out.println("Got form and root");
                        ChordForm nextForm = null;
                        String nextRoot = null;
                        if(nextChord != null){
                            nextForm = nextChord.getChordSymbol().getChordForm();
                            nextRoot = nextChord.getRoot();
                        }
                        //System.out.println("Got nextForm and nextRoot");
                        
                        // usableTones combines chord, color, and scale tones
                        // This could be done within ChordForm more efficiently

                        Polylist usableTones = Polylist.nil;
                        Polylist nextUsableTones = Polylist.nil;
                        //System.out.println("Checkpoint 1");
                        if(chordTones){
                            //System.out.println("Checkpoint 1.25");
                            usableTones = usableTones.append(form.getSpell(root));
                            if(nextForm!=null){
                                nextUsableTones = nextUsableTones.append(nextForm.getSpell(nextRoot));
                            }
                            
                        }
                        //System.out.println("Checkpoint 2");

                        //option to only include chord tones
                        if(colorTones){
                           usableTones = usableTones.append(form.getColor(root)); 
                           if(nextForm!=null){
                             nextUsableTones = nextUsableTones.append(nextForm.getColor(nextRoot));  
                           }
                           
                        }
                        //System.out.println("Checkpoint 3");

                        // Not so good: usableTones = usableTones.append(form.getFirstScaleTones(root));

                        if( directional )
                        {
                            //System.out.println("Directional Mode");
                            // Directional transposition specified
                            resolved = Note.getClosestMatchDirectional(currentNote.getPitch(), usableTones, direction);
                        }
                        else
                        {
                            //System.out.println("Rectification Mode");
                            // Rectification specified
                            Note nextNote = part.getNextNote(i);
                            if(NoteSymbol.makeNoteSymbol(currentNote).enhMember(usableTones) )
                              {
                                // No rectification necessary
                                resolved = currentNote;
                                //System.out.println("No rectification necessary");
                                //System.out.println(resolved);
                                //TEST
//                                if(!NoteSymbol.makeNoteSymbol(resolved).enhMember(usableTones) )
//                              {
//                                  System.out.println("No rectification necessary - not enhMember");
//                                System.out.println(resolved);
//                              }
                              }
                            //PROBLEM: They are using the chord of the current note to see if the next note is a chord/color tone - BAD
                            else if( approachTones && nextNote != null && nextNote.adjacentPitch(currentNote) && NoteSymbol.makeNoteSymbol(nextNote).enhMember(nextUsableTones) )
                            {
                                // Allow approach tones to stand
                                //System.out.println("allowing approach: " + currentNote.toLeadsheet() + " to " + nextNote.toLeadsheet() );
                                
                                resolved = currentNote;
                                //TEST
                                //System.out.println("Allow approach tones to stand");
                                //System.out.println(resolved);
//                                if(!NoteSymbol.makeNoteSymbol(resolved).enhMember(usableTones) )
//                              {
//                                  System.out.println("Allow approach tones to stand - not enhMember");
//                                System.out.println(resolved);
//                              }
                                
                                //System.out.println("Allow approach tone");
                                //System.out.println(currentNote);
                            }
                            else
                              {
                                // Move anything else to a usable tone
                                  //This should NOT use getClosestMatchDirectional because a direction was not specified.
                                  resolved = Note.getClosestMatch(currentNote.getPitch(), usableTones);
                                  
                              //resolved = Note.getClosestMatchDirectional(currentNote.getPitch(), usableTones, direction);

                                resolved.setRhythmValue(value);
                                //System.out.println("Move anything else to a usable tone");
                                //System.out.println(resolved);
                                //TEST
//                                if(!NoteSymbol.makeNoteSymbol(resolved).enhMember(usableTones) )
//                              {
//                                  System.out.println("Move anything else to a usable tone - not enhMember");
//                                System.out.println(resolved);
//                              }                              
                                //System.out.println("Move to usable tone");
                                //System.out.println(resolved);
                              }
                        }

                        // If note is a repeat of the previous, try moving it up or down a half step then
                        // resolving it in the direction moved.

                        /*if( previouslyResolved != null && previouslyResolved.samePitch(resolved) )
                          {
                            // Decide direction randomly

                            boolean dir = Math.random() > 0.5;

                            int offset = dir ? +1 : -1;

                            resolved =
                                Note.getClosestMatchDirectional(resolved.getPitch()+offset, usableTones, dir);

                            //System.out.println(
                            //    "repeated pitch at slot " + i + ": " + resolved.toLeadsheet() + " to " + previouslyResolved.toLeadsheet() + ", dir = " + dir);
                           }*/
                      }
                    
                     part.setNote(i, resolved);
                     
                     
                     //was used to prevent having two of the same note in a row
                     //previousNote = currentNote;
                     //previouslyResolved = resolved;

                     //previousIndex = i;
                  }

               slotsRemaining -= value;
               }
           }
        if( mergeRepeatedPitches )
           {
          part.removeRepeatedNotesInPlace();
          }
      }
    catch( Exception ex )
      {
        //ErrorLog.log(ErrorLog.WARNING, "*** Warning: pitch resolution failed.");
      }
  //playIt();
//    int duration = part.getNote(0).getRhythmValue();
//    for(int i = 0; i <= part.getLastActiveSlot(); i += duration){
//        Note n = part.getNote(i);
//        Note next = part.getNextNote(i);
//        Chord c = chordProg.getCurrentChord(i);
//        Polylist usableTones = c.getSpell().append(c.getColor());
//        if(!n.isRest() && NoteSymbol.makeNoteSymbol(n).enhMember(usableTones)){
//            if(n.adjacentPitch(next)){
//                System.out.println("Approach:");
//            }else{
//                System.out.println("Red:");
//            }
//            System.out.println(n);
//        }
//    }
  }
  
  private void playIt()
  {
    if( ImproVisor.getPlay() )
      {
      ImproVisor.playCurrentSelection(false, 0, PlayScoreCommand.USEDRUMS);

      //new PlayPartCommand(part.extract(startIndex, stopIndex)).execute();
      }
    
  }

  /**
   * Undoes the shifts.
   */
  public void undo()
    {
    saveForRedo = part.extract(startIndex, stopIndex);
    part.pasteOver(originalPart, startIndex);
    playIt();
    }

  /**
   * Redoes the shifts.
   */
  public void redo()
    {
    part.pasteOver(saveForRedo, startIndex);
    playIt();
    }

  public boolean isUndoable()
    {
    return undoable;
    }

  }

```

### File: src\imp\voicing\VoicingGenerator.java

```java

//jmusic for synthesis
package imp.voicing;

import java.util.ArrayList;

/**
 * This class is the actual voicing calculator, takes very specific parameters that can be randomized using hand manager and stored in automatic voicing settings.
 * Instructions: Initialize with priorities in constructor. 
 * Chord notes, hand bounds, and number of notes per hand should be set with each new chord.
 * The number of notes/hand, and hand bounds should have some degree of randomness.
 * Call calculate to actually calculate chord tones, and then get the integer array of midi notes to be played.
 *
 * The way this class works: all available notes are individually weighted, and array lists are created containing n duplicates of each note in each hand's range where n is the weight of the note.
 * Notes are picked randomly from the list.
 * Once a note is picked, the notes around it and exactly an octave (and multiple octaves) above and below are multiplied by the multiplier settings and new array lists are generated.
 * The process is repeated until the array list is empty or the number of desired notes is reached.
 * @author Daniel Scanteianu
 */
public class VoicingGenerator {

    public VoicingGenerator() {
    }

    /**
     * 
     * @param colorPriority-the weight the color notes should have. Make it between 0 and a big-ish number
     * @param maxPriority-the maximum weight the priority notes should have. should be greater than the max number of priority notes*the priority multiplier.
     * @param previousVoicingMultiplier- amount to multiply the weight of the notes in the previous voicing's weightings by. Default: 1. Make greater than 1 for voice leading.
     * @param halfStepAwayMultiplier-amount to multiply the weight of the notes half a step away from the previous chord Default: 1. Make greater than 1 for voice leading.
     * @param fullStepAwayMultiplier-amount to multiply the weight of the notes a full step away from the previous chord. Default: 1. Make greater than 1 for voice leading.
     * @param priorityMultiplier - amount of weight to remove from notes as priority decreases. Default 0 for equal probability.
     * @param repeatMultiplier - the amount to reduce(or increase) the priority of notes already selected for the chord in other octaves. for reduction, make between 0 and 1. Default 1.
     */
        public VoicingGenerator(int leftColorPriority,int rightColorPriority, int maxPriority, double previousVoicingMultiplier, double halfStepAwayMultiplier, double fullStepAwayMultiplier, double priorityMultiplier, double repeatMultiplier, double halfStepReducer, double fullStepReducer, boolean invertM9) {
        this.leftColorPriority = leftColorPriority;
        this.rightColorPriority=rightColorPriority;
        this.maxPriority = maxPriority;
        this.previousVoicingMultiplier = previousVoicingMultiplier;
        this.halfStepAwayMultiplier = halfStepAwayMultiplier;
        this.fullStepAwayMultiplier = fullStepAwayMultiplier;
        this.priorityMultiplier = priorityMultiplier;
        this.repeatMultiplier = repeatMultiplier;
        this.halfStepReducer = halfStepReducer;
        this.fullStepReducer = fullStepReducer;
        this.invertM9=invertM9;
    }
        
    public void getVoicingSettings(AutomaticVoicingSettings avs)
    {
        setFullStepAwayMultiplier(avs.getFullStepAwayMultiplier());
        setHalfStepAwayMultiplier(avs.getHalfStepAwayMultiplier());
        setMaxPriority(avs.getMaxPriority());
        setLeftColorPriority(avs.getLeftColorPriority());
        setRightColorPriority(avs.getRightColorPriority());
        setPreviousVoicingMultiplier(avs.getPreviousVoicingMultiplier());
        setRepeatMultiplier(avs.getRepeatMultiplier());
        setHalfStepReducer(avs.getHalfStepReducer());
        setFullStepReducer(avs.getFullStepReducer());
        setInvertM9(avs.getInvertM9());
        setVoiceAll(avs.getVoiceAll());
        setRootless(avs.getRootless());
        setLeftMinInterval(avs.getLeftMinInterval());
        setRightMinInterval(avs.getRightMinInterval());
    }
    
    public void getHandSettings(HandManager hm)
    {
        setLowerLeftBound(hm.getLeftHandLowestNote());
        setUpperLeftBound(hm.getLeftHandLowestNote() + hm.getLeftHandSpread());
        setLowerRightBound(hm.getRightHandLowestNote());
        setUpperRightBound(hm.getRightHandLowestNote() + hm.getRightHandSpread());
        setNumNotesLeft(hm.getNumLeftNotes());
        setNumNotesRight(hm.getNumRightNotes());
    }
    /**
     * generates a voicing based on current parameters and stores it in the chord array accessible by get chord. 
     */
    public void calculate()
    {
        allLeftValues=new ArrayList<Integer>();
        allRightValues=new ArrayList<Integer>();
        leftHand=new ArrayList<Integer>();
        rightHand=new ArrayList<Integer>();
        
        int noteToAdd;
        int start=0;
        
        if(voiceAll)
        {
            //System.out.println("Driving VAN");
            //enable only chord notes
            for(int i=0; i<allMidiValues.length; i++)
            {
                allMidiValues[i]=0;
            }
            for(int p=0; p<priority.length; p++)
            {
                setupNote(priority[p], (int)(maxPriority*10-p*10*priorityMultiplier));
            }
            if(rootless)
                setupNote(root,0);
            
            //do usual calculations, modded to ensure all notes happen
            for(int i=0; i<priority.length; i++)
            {
                setupAllLeftValues();   
                if(!allLeftValues.isEmpty())
                {
                    if(i<priority.length)
                    {
                        noteToAdd=allLeftValues.get((int)(Math.random()*allLeftValues.size()));
                        leftHand.add(noteToAdd);
                        allMidiValues[noteToAdd]=0;
                        if(allMidiValues[noteToAdd+1]*halfStepReducer>0)
                            allMidiValues[noteToAdd+1]*=halfStepReducer;
                        if(allMidiValues[noteToAdd-1]*halfStepReducer>0)
                            allMidiValues[noteToAdd-1]*=halfStepReducer;
                        if(allMidiValues[noteToAdd+2]*halfStepReducer>0)
                            allMidiValues[noteToAdd+2]*=halfStepReducer;
                        if(allMidiValues[noteToAdd-2]*halfStepReducer>0)
                            allMidiValues[noteToAdd-2]*=halfStepReducer;
                        multiplyNotes(noteToAdd,0);

                    }
                }
                setupAllRightValues();
                if(!allRightValues.isEmpty())
                {
                    if(i<priority.length)
                    {
                        noteToAdd=allRightValues.get((int)(Math.random()*allRightValues.size()));
                        
                        rightHand.add(noteToAdd);
                        allMidiValues[noteToAdd]=0;
                        if(allMidiValues[noteToAdd+1]*halfStepReducer>0)
                            allMidiValues[noteToAdd+1]*=halfStepReducer;
                        if(allMidiValues[noteToAdd-1]*halfStepReducer>0)
                            allMidiValues[noteToAdd-1]*=halfStepReducer;
                        if(allMidiValues[noteToAdd+2]*halfStepReducer>0)
                            allMidiValues[noteToAdd+2]*=halfStepReducer;
                        if(allMidiValues[noteToAdd-2]*halfStepReducer>0)
                            allMidiValues[noteToAdd-2]*=halfStepReducer;
                        multiplyNotes(noteToAdd,0);

                    }

                }
                
            }
            if(rightHand.size()<leftHand.size())
                start=rightHand.size();
            else
                start=leftHand.size();
        }
        //begin normal algorithm
        initAllMidiValues();
        if(rootless)
                setupNote(root,0);
        for(int i:leftHand)
            allMidiValues[i]=0;
        for(int i:rightHand)
            allMidiValues[i]=0;
        if(previousVoicing!=null)
            weightPreviousVoicing();
        VoicingDebug.println((numNotesLeft+numNotesRight)+" #notes exp.");
        VoicingDebug.println(lowerRightBound+" lower right bound");
        for(int i = start; i<numNotesLeft || i<numNotesRight; i++)
        {
            setupAllLeftValues();   
            if(!allLeftValues.isEmpty())
            {
                if(leftHand.size()<numNotesLeft)
                {
                    noteToAdd=allLeftValues.get((int)(Math.random()*allLeftValues.size()));
                    leftHand.add(noteToAdd);
                    
                    allMidiValues[noteToAdd]=0;
                    allMidiValues[noteToAdd+1]*=halfStepReducer;
                    allMidiValues[noteToAdd-1]*=halfStepReducer;
                    allMidiValues[noteToAdd+2]*=fullStepReducer;
                    allMidiValues[noteToAdd-2]*=fullStepReducer;
                    multiplyNotes(noteToAdd,repeatMultiplier);
                    for(int j=0; j<leftMinInterval; j++)
                    {
                        allMidiValues[noteToAdd+j]=0;
                        allMidiValues[noteToAdd-j]=0;
                }
            }
            else
                VoicingDebug.println("LH EMPTY: Req:"+this.numNotesLeft+" act:");
                
            }
            setupAllRightValues();
            if(!allRightValues.isEmpty())
            {
                if(rightHand.size()<numNotesRight)
                {
                    noteToAdd=allRightValues.get((int)(Math.random()*allRightValues.size()));
                    
                    rightHand.add(noteToAdd);
                    allMidiValues[noteToAdd]=0;
                    allMidiValues[noteToAdd+1]*=halfStepReducer;
                    allMidiValues[noteToAdd-1]*=halfStepReducer;
                    allMidiValues[noteToAdd+2]*=fullStepReducer;
                    allMidiValues[noteToAdd-2]*=fullStepReducer;
                    multiplyNotes(noteToAdd,repeatMultiplier);
                    for(int j=0; j<rightMinInterval; j++)
                    {
                        allMidiValues[noteToAdd+j]=0;
                        VoicingDebug.println("noteToAdd+i: "+(noteToAdd+i));
                        allMidiValues[noteToAdd-j]=0;
                    }
                }
            
            }
            else
                VoicingDebug.println("RH EMPTY");
           // System.out.println("calculate called");
            if(invertM9)
            {
                invertM9th(leftHand, leftHand);
                invertM9th(leftHand, rightHand);
                invertM9th(rightHand, rightHand);
            }
            
            
        }
        
        
    }

    public double getHalfStepReducer() {
        return halfStepReducer;
    }

    public void setHalfStepReducer(double halfStepReducer) {
        this.halfStepReducer = halfStepReducer;
    }

    public double getFullStepReducer() {
        return fullStepReducer;
    }

    public void setFullStepReducer(double fullStepReducer) {
        this.fullStepReducer = fullStepReducer;
    }
    /**
     * this is for voice leading, makes it likelier to hit notes in or near the last voicing.
     */
    private void weightPreviousVoicing()
    {
        for(int n: previousVoicing)
        {
            allMidiValues[n]=(int) (allMidiValues[n]*previousVoicingMultiplier);
        }
        for(int n: previousVoicing)
        {
            allMidiValues[n+1]=(int) (allMidiValues[n+1]*halfStepAwayMultiplier);
        }
        for(int n: previousVoicing)
        {
            allMidiValues[n-1]=(int) (allMidiValues[n-1]*halfStepAwayMultiplier);
        }
        for(int n: previousVoicing)
        {
            allMidiValues[n-2]=(int) (allMidiValues[n-2]*fullStepAwayMultiplier);
        }
        for(int n: previousVoicing)
        {
            allMidiValues[n+2]=(int) (allMidiValues[n+2]*fullStepAwayMultiplier);
        }
    }
    /**
     * sets up the midi values for a new chord 
     */
    private void initAllMidiValues()
    {
        //start with everything at zero
        for(int i=0; i<allMidiValues.length; i++)
        {
            allMidiValues[i]=0;
        }
        for(int i=0; i<color.length; i++)
        {
            setupNote(color[i],leftColorPriority*10);
        }
        for(int i=0; i<color.length; i++)
        {
            setupNote(color[i],rightColorPriority*10,lowerRightBound);
        }
        for(int p=0; p<priority.length; p++)
        {
            setupNote(priority[p], (int)(maxPriority*10-p*10*priorityMultiplier));
        }
    }
    /**
     * sets up left array list
     */
    private void setupAllLeftValues() {
       allLeftValues=new ArrayList<Integer>();
       for(int i=lowerLeftBound; i<=upperLeftBound; i++)
       {
           for(int j=0; j<allMidiValues[i]; j++)
           {
               allLeftValues.add(i);
           }
       }
    }
    /**
     * sets up right array list
     */
    private void setupAllRightValues() {
       allRightValues=new ArrayList<Integer>();
       for(int i=lowerRightBound; i<=upperRightBound; i++)
       {
           for(int j=0; j<allMidiValues[i]; j++)
           {
               allRightValues.add(i);
           }
       }
    }
    /**
     * Sets up all of a certain note to a certain value in all octaves
     * @param midiValue the note (gets converted to mod12)
     * @param priority  the value to set up the note to
     */
    private void setupNote(int midiValue, int priority)
    {
        midiValue=midiValue%12;
        for(int i=midiValue; i<allMidiValues.length; i+=12)
        {
            allMidiValues[i]=priority;
        }
    }
    /**
     * Sets up all of a certain note to a certain value in all octaves above the note start
     * @param midiValue the note (gets converted to mod12)
     * @param priority  the value to set up the note to
     * @param start the note from which to start setting up the note
     */
    private void setupNote(int midiValue, int priority, int start)
    {
        midiValue=midiValue%12;
        for(int i=start; i<allMidiValues.length; i++)
        {
            if(i%12==midiValue)
                allMidiValues[i]=priority;
        }
    }
    /**
     * checks 2 lists for a minor 9th between them, and flips the interval to a maj. 7th. the lists may be the same list.
     * @param list1
     * @param list2 
     */
    private void invertM9th(ArrayList<Integer> list1, ArrayList<Integer> list2)
    {   
//        System.out.println("invm9");
        ArrayList<Integer> list3=new ArrayList<Integer>();
        ArrayList<Integer> list4;
//        for(int i: list1)
//            System.out.print(i+" ");
//        System.out.println("list1orig");
//        for(int j: list2)
//            System.out.print(j+" ");
//        System.out.println("list2orig");
        for(int i:list1)
        {
            boolean added=false;
            list4=new ArrayList<Integer>();
            for(int j:list2)
            {
                //System.out.println("invoked, i:"+ i+", j:"+j);
                if(j-i==13)
                {
                    if(added)
                        list3.remove(list3.size()-1);
                    list3.add(i+1);
                    added=true;
                    list4.add(j-1);
                    VoicingDebug.println("Inverted m9 i"+i+" "+j);
                }
                else{
                    list4.add(j);
                    if(!added)
                    {
                        list3.add(i);
                        added=true;
                    }
                }
            }
            
            list2=list4;
        }
        list1=list3;
        
//        for(int i: list1)
//            System.out.print(i+" ");
//        System.out.println("list1");
//        for(int j: list2)
//            System.out.print(j+" ");
//        System.out.println("list2");
    }
    public int[] getColor() {
        return color;
    }

    public void setColor(int[] color) {
        this.color = color;
    }

    public int[] getPriority() {
        return priority;
    }

    public void setPriority(int[] priority) {
        this.priority = priority;
    }
    public int getLowerLeftBound() {
        return lowerLeftBound;
    }

    public void setLowerLeftBound(int lowerLeftBound) {
        this.lowerLeftBound = lowerLeftBound;
    }

    public int getUpperLeftBound() {
        return upperLeftBound;
    }

    public void setUpperLeftBound(int upperLeftBound) {
        this.upperLeftBound = upperLeftBound;
    }

    public int getLowerRightBound() {
        return lowerRightBound;
    }

    public void setLowerRightBound(int lowerRightBound) {
        this.lowerRightBound = lowerRightBound;
    }

    public int getUpperRightBound() {
        return upperRightBound;
    }

    public void setUpperRightBound(int upperRightBound) {
        this.upperRightBound = upperRightBound;
    }

    public int getNumNotesLeft() {
        return numNotesLeft;
    }

    public void setNumNotesLeft(int numNotesLeft) {
        this.numNotesLeft = numNotesLeft;
    }

    public int getNumNotesRight() {
        return numNotesRight;
    }

    public void setNumNotesRight(int numNotesRight) {
        this.numNotesRight = numNotesRight;
    }

    public int getLeftColorPriority() {
        return leftColorPriority;
    }

    public void setLeftColorPriority(int leftColorPriority) {
        this.leftColorPriority = leftColorPriority;
    }

    public int getRightColorPriority() {
        return rightColorPriority;
    }

    public void setRightColorPriority(int rightColorPriority) {
        this.rightColorPriority = rightColorPriority;
    }

   
    public int getMaxPriority() {
        return maxPriority;
    }

    public void setMaxPriority(int maxPriority) {
        this.maxPriority = maxPriority;
    }

    public int[] getPreviousVoicing() {
        return previousVoicing;
    }

    public void setPreviousVoicing(int[] previousVoicing) {
        this.previousVoicing = previousVoicing;
    }

    public double getPreviousVoicingMultiplier() {
        return previousVoicingMultiplier;
    }

    public void setPreviousVoicingMultiplier(double previousVoicingMultiplier) {
        this.previousVoicingMultiplier = previousVoicingMultiplier;
    }

    public double getHalfStepAwayMultiplier() {
        return halfStepAwayMultiplier;
    }

    public void setHalfStepAwayMultiplier(double halfStepAwayMultiplier) {
        this.halfStepAwayMultiplier = halfStepAwayMultiplier;
    }

    public double getFullStepAwayMultiplier() {
        return fullStepAwayMultiplier;
    }

    public void setFullStepAwayMultiplier(double fullStepAwayMultiplier) {
        this.fullStepAwayMultiplier = fullStepAwayMultiplier;
    }

    public double getPriorityMultiplier() {
        return priorityMultiplier;
    }

    public void setPriorityMultiplier(double priorityMultiplier) {
        this.priorityMultiplier = priorityMultiplier;
    }

    public double getRepeatMultiplier() {
        return repeatMultiplier;
    }

    public void setRepeatMultiplier(double repeatMultiplier) {
        this.repeatMultiplier = repeatMultiplier;
    }
    private void multiplyNotes(int midiValue, double multiplier)
    {
        midiValue=midiValue%12;
        for(int i=midiValue; i<allMidiValues.length; i+=12)
        {
            allMidiValues[i]=(int)(allMidiValues[i]*multiplier);
        }
    }
    /**
     *  generates array with notes in LH
     * @return int array
     */
    public int[] getLeftHand()
    {
        int[] leftArray=new int[leftHand.size()];
        for(int i=0; i<leftHand.size(); i++)
        {
            leftArray[i]=leftHand.get(i);
        }
        return leftArray;
    }
    /**
     * generates array with notes in RH
     * @return int array
     */
    public int[] getRightHand()
    {
        int[] rightArray=new int[rightHand.size()];
        for(int i=0; i<rightHand.size(); i++)
        {
            rightArray[i]=rightHand.get(i);
        }
        return rightArray;
    }
    /**
     * generates int array with all notes in chord.
     * @return int array with chord.
     */
    public int[] getChord()
    {
        int[] chord=new int[rightHand.size()+leftHand.size()];
        ArrayList<Integer> chordList=new ArrayList<Integer>();
        chordList.addAll(leftHand);
        chordList.addAll(rightHand);
        for(int i=0; i<chordList.size();i++)
        {
            chord[i]=chordList.get(i);
        }
        return chord;
        
    }
     public int getLeftMinInterval() {
        return leftMinInterval;
    }

    public void setLeftMinInterval(int leftMinInterval) {
        this.leftMinInterval = leftMinInterval;
    }

    public int getRightMinInterval() {
        return rightMinInterval;
    }

    public void setRightMinInterval(int rightMinInterval) {
        this.rightMinInterval = rightMinInterval;
    }
    public boolean isVoiceAll() {
        return voiceAll;
    }
    public boolean getVoiceAll() {
        return voiceAll;
    }
    public void setVoiceAll(boolean voiceAll) {
        this.voiceAll = voiceAll;
    }
    private boolean invertM9;
    public boolean isInvertM9() {
        return invertM9;
    }
    
    public boolean getInvertM9() {
        return invertM9;
    }

    public void setInvertM9(boolean invertM9) {
        this.invertM9 = invertM9;
    }

    public int getRoot() {
        return root;
    }

    public void setRoot(int root) {
        this.root = root;
    }

    public boolean isRootless() {
        return rootless;
    }

    public void setRootless(boolean rootless) {
        this.rootless = rootless;
    }
    
    private int allMidiValues[]= new int[128];
    private int root;
    private int color[];
    private int priority[];
    private ArrayList<Integer> leftHand;
    private ArrayList<Integer> rightHand;
    private ArrayList<Integer> allLeftValues;
    private ArrayList<Integer> allRightValues;
    private int lowerLeftBound;
    private int upperLeftBound;
    private int lowerRightBound;
    private int upperRightBound;
    private int numNotesLeft;
    private int numNotesRight;
    private int leftColorPriority;//priority of any color note
    private int rightColorPriority;
    private int maxPriority;//max priority a note in the priority array can have
    private int previousVoicing[];
    private double previousVoicingMultiplier;// multiplier for notes used in previous voicing
    private double halfStepAwayMultiplier;
    private double fullStepAwayMultiplier;
    private double priorityMultiplier;//should be between 0 and 1, multiply this by the index in priority array, subtract result from max priority to get note priority
    private double repeatMultiplier;
    private double halfStepReducer;
    private double fullStepReducer;
    private boolean voiceAll;
    private boolean rootless;
    private int leftMinInterval;
    private int rightMinInterval;

   

    
    

}

```


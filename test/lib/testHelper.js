
/*
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing,
* software distributed under the License is distributed on an
* "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
* KIND, either express or implied.  See the License for the
* specific language governing permissions and limitations
* under the License.
*/

(function (context) {

    var DEFAULT_DATA_TABLE_LIMIT = 8;

    var objToString = Object.prototype.toString;
    var TYPED_ARRAY = {
        '[object Int8Array]': 1,
        '[object Uint8Array]': 1,
        '[object Uint8ClampedArray]': 1,
        '[object Int16Array]': 1,
        '[object Uint16Array]': 1,
        '[object Int32Array]': 1,
        '[object Uint32Array]': 1,
        '[object Float32Array]': 1,
        '[object Float64Array]': 1
    };

    var params = {};
    var parts = location.search.slice(1).split('&');
    for (var i = 0; i < parts.length; ++i) {
        var kv = parts[i].split('=');
        params[kv[0]] = kv[1];
    }

    if ('__SEED_RANDOM__' in params) {
        require(['../node_modules/seedrandom/seedrandom.js'], function (seedrandom) {
            var myRandom = new seedrandom('echarts-random');
            // Fixed random generator
            Math.random = function () {
                return myRandom();
            };
        });
    }

    var testHelper = {};


    /**
     * @param {Object} opt
     * @param {string|Array.<string>} [opt.title] If array, each item is on a single line.
     *        Can use '**abc**', means <strong>abc</strong>.
     * @param {Option} opt.option
     * @param {Object} [opt.info] info object to display.
     *        info can be updated by `chart.__testHelper.updateInfo(someInfoObj, 'some_info_key');`
     * @param {string} [opt.infoKey='option']
     * @param {Object|Array} [opt.dataTable]
     * @param {Array.<Object|Array>} [opt.dataTables] Multiple dataTables.
     * @param {number} [opt.dataTableLimit=DEFAULT_DATA_TABLE_LIMIT]
     * @param {number} [opt.width]
     * @param {number} [opt.height]
     * @param {boolean} [opt.draggable]
     * @param {boolean} [opt.lazyUpdate]
     * @param {boolean} [opt.notMerge]
     * @param {boolean} [opt.autoResize=true]
     * @param {string} [opt.inputsStyle='normal'] Optional, can be 'normal', 'compact'.
     *  Can be either `inputsStyle` or `buttonsStyle`.
     * @param {number} [opt.inputsHeight] Default not fix height. If specified, a scroll
     *  bar will be displayed if overflow the height. In visual test, once a height changed
     *  by adding something, the subsequent position will be changed, leading to test failures.
     *  Fixing the height helps avoid this.
     *  Can be either `inputsHeight` or `buttonsHeight`.
     * @param {Array.<Object>|Object|Function} [opt.inputs]
     *  They are the same: `opt.buttons` `opt.button`, `opt.inputs`, `opt.input`
     *  It can be a function that return buttons configuration, like:
     *      inputs: chart => { return [{text: 'xxx', onclick: fn}, ...]; }
     *  Item can be these types:
     *  [{
     *      // A button (default).
     *      text: 'xxx',
     *      // They are the same: `onclick`, `click` (capital insensitive)
     *      onclick: fn
     *  }, {
     *      // A range slider (HTML <input type="range">).
     *      type: 'range', // Or 'slider'
     *      id: 'some_id', // Optional. Can be used in `getState` and `setState`.
     *      stateGroup: 'some_state_group', // Optional. Can be used in `getState` and `setState`.
     *      text: 'xxx', // Optional
     *      min: 0, // Optional
     *      max: 100, // Optional
     *      value: 30, // Optional. Must be a number.
     *      step: 1, // Optional
     *      // They are the same: `oninput` `input`
     *      //                    `onchange` `change`
     *      //                    `onselect` `select` (capital insensitive)
     *      onchange: function () { console.log(this.value); }
     *  }, {
     *      // A select (HTML <select>...</select>).
     *      type: 'select', // Or `selection`
     *      id: 'some_id', // Optional. Can be used in `getState` and `setState`.
     *      stateGroup: 'some_state_group', // Optional. Can be used in `getState` and `setState`.
     *      // Either `values` or `options` can be used.
     *      // Items in `values` or `options[i].value` can be any type, like `true`, `123`, etc.
     *      values: ['a', 'b', 'c'],
     *      options: [
     *          {text: 'a', value: 123},
     *          {value: {some: {some: 456}}}, // `text` can be omitted and auto generated by `value`.
     *          {text: 'c', input: ...}, // `input` can be used as shown below.
     *          ...
     *      ],
     *      // `options[i]` can nest other input type, currently only support `type: range`:
     *      options: [
     *          {value: undefined},
     *          {text: 'c', input: {
     *              type: 'range',
     *              // ... Other properties of `range` input except `onchange` and `text`.
     *              // When this option is not selected, the range input will be disabled.
     *          }}
     *      ],
     *      valueIndex: 0, // Optional. The initial value index. By default, the first option.
     *      value: 'cval', // Optional. The initial value. By default, the first option.
     *                     // Can be any type, like `true`, `123`, etc.
     *                     // But can only be JS primitive type, as `===` is used internally.
     *      text: 'xxx', // Optional.
     *      // They are the same: `oninput` `input`
     *      //                    `onchange` `change`
     *      //                    `onselect` `select` (capital insensitive)
     *      onchange: function () { console.log(this.value); }
     *  }, {
     *      // A line break.
     *      // They are the same: `br` `lineBreak` `break` `wrap` `newLine` `endOfLine` `carriageReturn`
     *      //                    `lineFeed` `lineSeparator` `nextLine` (capital insensitive)
     *      type: 'br',
     *  },
     *  // ...
     *  ]
     *  The value of the inputs can be update by:
     *      chart.__testHelper.setState({'some_id_1': 'value1', 'some_id_2': 'value2'});
     *      // Only set state from input that has 'some_state_group_1'.
     *      chart.__testHelper.setState({...}, 'some_state_group_1');
     *      // Get: {some_id_1: 'value1', some_id_2: 'value2'}
     *      chart.__testHelper.getState();
     *      // Only get state from input that has 'some_state_group_1'.
     *      chart.__testHelper.getState('some_state_group_1');
     * @param {boolean} [opt.recordCanvas] 'test/lib/canteen.js' is required.
     * @param {boolean} [opt.recordVideo]
     * @param {string} [opt.renderer] 'canvas' or 'svg'
     */
    testHelper.create = function (echarts, domOrId, opt) {
        var dom = getDom(domOrId);

        if (!dom) {
            return;
        }

        var errMsgPrefix = '[testHelper dom: ' + domOrId + ']';

        var title = document.createElement('div');
        var left = document.createElement('div');
        var chartContainer = document.createElement('div');
        var inputsContainer = document.createElement('div');
        var dataTableContainer = document.createElement('div');
        var infoContainer = document.createElement('div');
        var recordCanvasContainer = document.createElement('div');
        var recordVideoContainer = document.createElement('div');

        title.setAttribute('title', dom.getAttribute('id'));

        var inputsHeight = testHelper.retrieveValue(opt.inputsHeight, opt.buttonsHeight, null);
        if (inputsHeight != null) {
            inputsHeight = parseFloat(inputsHeight);
        }

        title.className = 'test-title';
        dom.className = 'test-chart-block';
        left.className = 'test-chart-block-left';
        chartContainer.className = 'test-chart';
        dataTableContainer.className = 'test-data-table';
        infoContainer.className = 'test-info';
        recordCanvasContainer.className = 'record-canvas';
        recordVideoContainer.className = 'record-video';

        inputsContainer.className = [
            'test-inputs',
            'test-buttons', // deprecated but backward compat.
            'test-inputs-style-' + (opt.inputsStyle || opt.buttonsStyle || 'normal'),
            (inputsHeight != null ? 'test-inputs-fix-height' : '')
        ].join(' ');
        if (inputsHeight != null) {
            inputsContainer.style.cssText = [
                'height:' + inputsHeight + 'px',
            ].join(';') + ';';
        }

        if (opt.info) {
            dom.className += ' test-chart-block-has-right';
            infoContainer.className += ' test-chart-block-right';
        }

        left.appendChild(recordCanvasContainer);
        left.appendChild(recordVideoContainer);
        left.appendChild(inputsContainer);
        left.appendChild(dataTableContainer);
        left.appendChild(chartContainer);
        dom.appendChild(infoContainer);
        dom.appendChild(left);
        dom.parentNode.insertBefore(title, dom);

        var chart;

        var optTitle = opt.title;
        if (optTitle) {
            if (optTitle instanceof Array) {
                optTitle = optTitle.join('\n');
            }
            title.innerHTML = '<div class="test-title-inner">'
                + testHelper.encodeHTML(optTitle)
                    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\n/g, '<br>')
                + '</div>';
        }

        chart = testHelper.createChart(echarts, chartContainer, opt.option, opt, opt.setOptionOpts, errMsgPrefix);

        var dataTables = opt.dataTables;
        if (!dataTables && opt.dataTable) {
            dataTables = [opt.dataTable];
        }
        if (dataTables) {
            var tableHTML = [];
            for (var i = 0; i < dataTables.length; i++) {
                tableHTML.push(createDataTableHTML(dataTables[i], opt));
            }
            dataTableContainer.innerHTML = tableHTML.join('');
        }

        var inputsResult;
        if (chart) {
            inputsResult = initInputs(chart, opt, inputsContainer, errMsgPrefix);
        }

        if (opt.info) {
            updateInfo(opt.info, opt.infoKey);
        }

        function updateInfo(info, infoKey) {
            infoContainer.innerHTML = createObjectHTML(info, infoKey || 'option');
        }

        initRecordCanvas(opt, chart, recordCanvasContainer);

        if (opt.recordVideo) {
            testHelper.createRecordVideo(chart, recordVideoContainer);
        }

        chart.__testHelper = {
            updateInfo: updateInfo,
            setState: inputsResult && inputsResult.setState,
            getState: inputsResult && inputsResult.getState
        };

        return chart;
    };

    function initInputs(chart, opt, inputsContainer, errMsgPrefix) {
        var NAMES_ON_INPUT_CHANGE = makeFlexibleNames([
            'input', 'on-input', 'on-change', 'select', 'on-select'
        ]);
        var NAMES_ON_CLICK = makeFlexibleNames([
            'on-click', 'click'
        ]);
        var NAMES_TYPE_BUTTON = makeFlexibleNames(['button', 'btn']);
        var NAMES_TYPE_RANGE = makeFlexibleNames(['range', 'slider']);
        var NAMES_TYPE_SELECT = makeFlexibleNames(['select', 'selection']);
        var NAMES_TYPE_BR = makeFlexibleNames([
            'br', 'line-break', 'break', 'wrap', 'new-line', 'end-of-line',
            'carriage-return', 'line-feed', 'line-separator', 'next-line'
        ]);
        // key: id, value: {setState, getState}
        var _inputsDict = {};

        init();

        return {setState: setState, getState: getState};


        function init() {
            var inputsDefineList = retrieveInputDefineList();

            for (var i = 0; i < inputsDefineList.length; i++) {
                var singleCreated = createInputByDefine(inputsDefineList[i]);
                if (!singleCreated) {
                    continue;
                }
                for (var j = 0; j < singleCreated.elList.length; j++) {
                    inputsContainer.appendChild(singleCreated.elList[j]);
                }
                var id = retrieveId(inputsDefineList[i], 'id');
                var stateGroup = retrieveId(inputsDefineList[i], 'stateGroup');
                if (stateGroup != null) {
                    if (id == null) {
                        id = generateId('test_inputs_');
                    }
                    singleCreated.stateGroup = stateGroup;
                }
                if (id != null) {
                    if (_inputsDict[singleCreated.id]) {
                        throw new Error(errMsgPrefix + 'Duplicate input id: ' + singleCreated.id);
                    }
                    singleCreated.id = id;
                    _inputsDict[singleCreated.id] = singleCreated;
                }
            }
        }

        function setState(state, stateGroup) {
            for (var id in state) {
                if (state.hasOwnProperty(id)) {
                    if (_inputsDict[id] == null) {
                        throw new Error(errMsgPrefix + 'No input with id: ' + id);
                    }
                    if (!stateGroup || _inputsDict[id].stateGroup === stateGroup) {
                        _inputsDict[id].setState(state[id]);
                    }
                }
            }
        }

        function getState(stateGroup) {
            var result = {};
            for (var id in _inputsDict) {
                if (_inputsDict.hasOwnProperty(id)
                    && (!stateGroup || _inputsDict[id].stateGroup === stateGroup)
                ) {
                    result[id] = _inputsDict[id].getState();
                }
            }
            return result;
        }

        function retrieveInputDefineList() {
            var defineList = testHelper.retrieveValue(opt.buttons, opt.button, opt.input, opt.inputs);
            if (typeof defineList === 'function') {
                defineList = defineList(chart);
            }
            if (!(defineList instanceof Array)) {
                defineList = defineList ? [defineList] : [];
            }
            return defineList;
        }

        function getBtnTextHTML(inputDefine, defaultText) {
            return testHelper.encodeHTML(testHelper.retrieveValue(inputDefine.name, inputDefine.text, defaultText));
        }
        function getBtnDefineAttr(inputDefine, attr, defaultValue) {
            return inputDefine[attr] != null ? inputDefine[attr] : defaultValue;
        }
        function getBtnEventListener(inputDefine, names) {
            for (var idx = 0; idx < names.length; idx++) {
                if (inputDefine[names[idx]]) {
                    return inputDefine[names[idx]];
                }
            }
        }

        function retrieveId(inputDefine, idPropName) {
            if (inputDefine && inputDefine[idPropName] != null) {
                var type = getType(inputDefine[idPropName]);
                if (type !== 'string' && type != 'number') {
                    throw new Error(errMsgPrefix + 'id must be string or number.');
                }
                return inputDefine[idPropName] + '';
            }
        }

        function createInputByDefine(inputDefine) {
            if (!inputDefine) {
                return;
            }
            var inputType = inputDefine.hasOwnProperty('type') ? inputDefine.type : 'button';

            if (arrayIndexOf(NAMES_TYPE_RANGE, inputType) >= 0) {
                var rangeInputCreated = createRangeInput(inputDefine);
                return {
                    elList: [rangeInputCreated.el],
                    getState: rangeInputCreated.getState,
                    setState: rangeInputCreated.setState
                };
            }
            else if (arrayIndexOf(NAMES_TYPE_SELECT, inputType) >= 0) {
                return createSelectInput(inputDefine);
            }
            else if (arrayIndexOf(NAMES_TYPE_BR, inputType) >= 0) {
                return {
                    elList: [createBr(inputDefine)]
                };
            }
            else if (arrayIndexOf(NAMES_TYPE_BUTTON, inputType) >= 0) {
                return {
                    elList: [createButtonInput(inputDefine)]
                };
            }
            else {
                throw new Error(errMsgPrefix + 'Unsupported button type: ' + inputType);
            }
        }

        function createRangeInput(inputDefine, internallyForceDef) {
            var sliderWrapperEl = document.createElement('span');
            resetWrapperCSS(false);

            var sliderTextEl = document.createElement('span');
            sliderTextEl.className = 'test-inputs-slider-text';
            sliderTextEl.innerHTML = internallyForceDef
                ? getBtnTextHTML(internallyForceDef, '')
                : getBtnTextHTML(inputDefine, '');
            sliderWrapperEl.appendChild(sliderTextEl);

            var sliderInputEl = document.createElement('input');
            sliderInputEl.className = 'test-inputs-slider-input';
            sliderInputEl.setAttribute('type', 'range');
            var sliderListener = internallyForceDef
                ? getBtnEventListener(internallyForceDef, NAMES_ON_INPUT_CHANGE)
                : getBtnEventListener(inputDefine, NAMES_ON_INPUT_CHANGE);
            if (!sliderListener) {
                throw new Error(errMsgPrefix + 'No listener (either ' + NAMES_ON_INPUT_CHANGE.join(', ') + ') specified for slider.');
            }
            sliderInputEl.addEventListener('input', function () {
                updateSliderValueEl();
                var target = {value: this.value};
                sliderListener.call(target, {target: target});
            });
            sliderInputEl.setAttribute('min', getBtnDefineAttr(inputDefine, 'min', 0));
            sliderInputEl.setAttribute('max', getBtnDefineAttr(inputDefine, 'max', 100));
            sliderInputEl.setAttribute('value', getBtnDefineAttr(inputDefine, 'value', 30));
            sliderInputEl.setAttribute('step', getBtnDefineAttr(inputDefine, 'step', 1));
            sliderWrapperEl.appendChild(sliderInputEl);

            var sliderValueEl = document.createElement('span');
            sliderValueEl.className = 'test-inputs-slider-value';
            function updateSliderValueEl() {
                var val = sliderInputEl.value;
                updateText(val);
            }
            function updateText(val) {
                sliderValueEl.innerHTML = testHelper.encodeHTML(val);
            }
            updateSliderValueEl();
            sliderWrapperEl.appendChild(sliderValueEl);

            function resetWrapperCSS(disabled) {
                sliderWrapperEl.className = 'test-inputs-slider'
                    + (internallyForceDef ? ' test-inputs-slider-sub' : '')
                    + (disabled ? ' test-inputs-slider-disabled' : '');
            }

            return {
                el: sliderWrapperEl,
                setState: function (state) {
                    if (state == null || !isFinite(+state.value)) {
                        throw new Error(errMsgPrefix + 'Invalid state: ' + printObject(state) + ' for range');
                    }
                    sliderInputEl.value = state.value;
                    updateText(state.value);
                },
                getState: function () {
                    return {value: +sliderInputEl.value};
                },
                disable: function (disabled) {
                    sliderInputEl.disabled = disabled;
                    resetWrapperCSS(disabled);
                }
            };
        }

        function createSelectInput(inputDefine) {
            var selectCtx = {
                _optionList: [],
                _selectEl: null,
                _optionIdxToSubInput: [],
                _elList: []
            };

            createElementsForSelect();

            var _selectListener = getBtnEventListener(inputDefine, NAMES_ON_INPUT_CHANGE);
            if (!_selectListener) {
                throw new Error(errMsgPrefix + 'No listener (either ' + NAMES_ON_INPUT_CHANGE.join(', ') + ') specified for select.');
            }

            initOptionsForSelect(inputDefine);

            selectCtx._selectEl.addEventListener('change', function () {
                var optionIdx = getOptionIndex(selectCtx._selectEl);
                disableSubInputs(optionIdx);
                handleSelectChange(getValueByOptionIndex(optionIdx));
            });

            setInitValue(inputDefine);

            return {
                elList: selectCtx._elList,
                getState: getStateForSelect,
                setState: setStateForSelect
            };

            function createElementsForSelect() {
                var selectWrapperEl = document.createElement('span');
                selectWrapperEl.className = 'test-inputs-select';

                var textEl = document.createElement('span');
                textEl.className = 'test-inputs-select-text';
                textEl.innerHTML = getBtnTextHTML(inputDefine, '');
                selectWrapperEl.appendChild(textEl);

                var selectEl = document.createElement('select');
                selectEl.className = 'test-inputs-select-select';
                selectWrapperEl.appendChild(selectEl);

                selectCtx._elList.push(selectWrapperEl);
                selectCtx._selectEl = selectEl;
            }

            function initOptionsForSelect(inputDefine) {
                // optionDef can be {text, value} or just value
                //  (value can be null/undefined/array/object/... everything).
                // Convinient but might cause ambiguity when a value happens to be {text, value}, but rarely happen.
                if (inputDefine.options) {
                    for (var optionIdx = 0; optionIdx < inputDefine.options.length; optionIdx++) {
                        var optionDef = inputDefine.options[optionIdx];
                        if (
                            !isObject(optionDef)
                            || (
                                !optionDef.hasOwnProperty('value')
                                && !isObject(optionDef.input)
                            )
                        ) {
                            throw new Error(
                                'Can only be {type: "select", options: {value: any, text?: string, input?: SubInput}[]}'
                            );
                        }
                        var text = getType(optionDef.text) === 'string'
                            ? optionDef.text
                            : makeTextByValue(optionDef);
                        selectCtx._optionList.push({
                            value: optionDef.value,
                            input: optionDef.input,
                            text: text
                        });
                    }
                }
                else if (inputDefine.values) {
                    for (var optionIdx = 0; optionIdx < inputDefine.values.length; optionIdx++) {
                        var value = inputDefine.values[optionIdx];
                        selectCtx._optionList.push({
                            value: value,
                            text: makeTextByValue({value: value})
                        });
                    }
                }
                if (!selectCtx._optionList.length) {
                    throw new Error(errMsgPrefix + 'No options specified for select.');
                }

                for (var optionIdx = 0; optionIdx < selectCtx._optionList.length; optionIdx++) {
                    var optionDef = selectCtx._optionList[optionIdx];
                    selectCtx._optionList[optionIdx] = optionDef;
                    var optionEl = document.createElement('option');
                    optionEl.innerHTML = testHelper.encodeHTML(optionDef.text);
                    // HTML select.value is always string. But it would be more convenient to
                    // convert it to user's raw input value type.
                    //  (The input raw value can be null/undefined/array/object/... everything).
                    optionEl.value = optionIdx;
                    selectCtx._selectEl.appendChild(optionEl);

                    if (optionDef.input) {
                        if (arrayIndexOf(NAMES_TYPE_RANGE, optionDef.input.type) < 0) {
                            throw new Error(errMsgPrefix + 'Sub input only supported for range input.');
                        }
                        var createdRangeInput = createRangeInput(optionDef.input, {
                            text: '',
                            onchange: function () {
                                handleSelectChange(this.value)
                            }
                        });
                        selectCtx._elList.push(createdRangeInput.el);
                        selectCtx._optionIdxToSubInput[optionIdx] = createdRangeInput;
                    }
                }
            }

            function getStateForSelect() {
                var subInputState = {};
                for (var optionIdx = 0; optionIdx < selectCtx._optionIdxToSubInput.length; optionIdx++) {
                    if (selectCtx._optionIdxToSubInput[optionIdx]) {
                        subInputState[optionIdx] = selectCtx._optionIdxToSubInput[optionIdx].getState();
                    }
                }
                return {
                    valueIndex: getOptionIndex(selectCtx._selectEl),
                    subInputState: subInputState
                };
            }

            function setStateForSelect(state) {
                if (state == null
                    || getType(state.valueIndex) !== 'number'
                    || !isObject(state.subInputState)
                ) {
                    throw new Error(errMsgPrefix + 'Invalid state: ' + printObject(state) + ' for select');
                }
                resetOptionIndex(state.valueIndex);
                for (var optionIdx in state.subInputState) {
                    if (state.subInputState.hasOwnProperty(optionIdx)) {
                        var subInput = selectCtx._optionIdxToSubInput[optionIdx];
                        if (subInput) {
                            subInput.setState(state.subInputState[optionIdx]);
                        }
                    }
                }
            }

            function setInitValue(inputDefine) {
                var initOptionIdx = 0;
                if (inputDefine.hasOwnProperty('valueIndex')) {
                    var valueIndex = inputDefine.valueIndex;
                    if (valueIndex < 0 || valueIndex >= selectCtx._optionList.length) {
                        throw new Error(errMsgPrefix + 'Invalid valueIndex: ' + valueIndex);
                    }
                    selectCtx._selectEl.value = selectCtx._optionList[valueIndex].value;
                    initOptionIdx = valueIndex;
                }
                else if (inputDefine.hasOwnProperty('value')) {
                    var found = false;
                    for (var idx = 0; idx < selectCtx._optionList.length; idx++) {
                        if (!selectCtx._optionList[idx].input && selectCtx._optionList[idx].value === inputDefine.value) {
                            found = true;
                            initOptionIdx = idx;
                        }
                    }
                    if (!found) {
                        throw new Error(errMsgPrefix + 'Value not found in select options: ' + inputDefine.value);
                    }
                }
                resetOptionIndex(initOptionIdx);
            }

            function resetOptionIndex(optionIdx) {
                disableSubInputs(optionIdx);
                selectCtx._selectEl.value = optionIdx;
            }

            function getOptionIndex(optionIndexHost) {
                return +optionIndexHost.value;
            }

            function getValueByOptionIndex(optionIdx) {
                return selectCtx._optionList[optionIdx].input
                    ? selectCtx._optionIdxToSubInput[optionIdx].getState().value
                    : selectCtx._optionList[optionIdx].value;
            }

            function handleSelectChange(value) {
                var target = {value: value};
                _selectListener.call(target, {target: target});
            }

            function disableSubInputs(currOptionIdx) {
                for (var i = 0; i < selectCtx._optionIdxToSubInput.length; i++) {
                    var subInput = selectCtx._optionIdxToSubInput[i];
                    if (subInput) {
                        subInput.disable(i !== currOptionIdx);
                    }
                }
            }

            function makeTextByValue(optionDef) {
                if (optionDef.hasOwnProperty('value')) {
                    return printObject(optionDef.value, {
                        arrayLineBreak: false, objectLineBreak: false, indent: 0, lineBreak: ''
                    });
                }
                else if (optionDef.input) {
                    return 'range input';
                }
            }
        }

        function createBr(inputDefine) {
            return document.createElement('br');
        }

        function createButtonInput(inputDefine) {
            var btn = document.createElement('button');
            btn.innerHTML = getBtnTextHTML(inputDefine, 'button');
            btn.addEventListener('click', getBtnEventListener(inputDefine, NAMES_ON_CLICK));
            return btn;
        }
    }

    function initRecordCanvas(opt, chart, recordCanvasContainer) {
        if (!opt.recordCanvas) {
            return;
        }
        recordCanvasContainer.innerHTML = ''
            + '<button>Show Canvas Record</button>'
            + '<button>Clear Canvas Record</button>'
            + '<div class="content-area"><textarea></textarea><br><button>Close</button></div>';
        var buttons = recordCanvasContainer.getElementsByTagName('button');
        var canvasRecordButton = buttons[0];
        var clearButton = buttons[1];
        var closeButton = buttons[2];
        var recordArea = recordCanvasContainer.getElementsByTagName('textarea')[0];
        var contentAraa = recordArea.parentNode;
        canvasRecordButton.addEventListener('click', function () {
            var content = [];
            eachCtx(function (zlevel, ctx) {
                content.push('\nLayer zlevel: ' + zlevel, '\n\n');
                if (typeof ctx.stack !== 'function') {
                    alert('Missing: <script src="test/lib/canteen.js"></script>');
                    return;
                }
                var stack = ctx.stack();
                for (var i = 0; i < stack.length; i++) {
                    var line = stack[i];
                    content.push(JSON.stringify(line), ',\n');
                }
            });
            contentAraa.style.display = 'block';
            recordArea.value = content.join('');
        });
        clearButton.addEventListener('click', function () {
            eachCtx(function (zlevel, ctx) {
                ctx.clear();
            });
            recordArea.value = 'Cleared.';
        });
        closeButton.addEventListener('click', function () {
            contentAraa.style.display = 'none';
        });

        function eachCtx(cb) {
            var layers = chart.getZr().painter.getLayers();
            for (var zlevel in layers) {
                if (layers.hasOwnProperty(zlevel)) {
                    var layer = layers[zlevel];
                    var canvas = layer.dom;
                    var ctx = canvas.getContext('2d');
                    cb(zlevel, ctx);
                }
            }
        }
    }

    testHelper.createRecordVideo = function (chart, recordVideoContainer) {
        var button = document.createElement('button');
        button.innerHTML = 'Start Recording';
        recordVideoContainer.appendChild(button);
        var recorder = new VideoRecorder(chart);

        var isRecording = false;


        button.onclick = function () {
            isRecording ? recorder.stop() : recorder.start();
            button.innerHTML = (isRecording ? 'Start' : 'Stop') + ' Recording';

            isRecording = !isRecording;
        }
    }

    /**
     * @param {ECharts} echarts
     * @param {HTMLElement|string} domOrId
     * @param {Object} option
     * @param {boolean|number} opt If number, means height
     * @param {boolean} opt.lazyUpdate
     * @param {boolean} opt.notMerge
     * @param {boolean} opt.useCoarsePointer
     * @param {boolean} opt.pointerSize
     * @param {number} opt.width
     * @param {number} opt.height
     * @param {boolean} opt.draggable
     * @param {string} opt.renderer 'canvas' or 'svg'
     * @param {string} errMsgPrefix
     */
    testHelper.createChart = function (echarts, domOrId, option, opt, errMsgPrefix) {
        if (typeof opt === 'number') {
            opt = {height: opt};
        }
        else {
            opt = opt || {};
        }

        var dom = getDom(domOrId);

        if (dom) {
            if (opt.width != null) {
                dom.style.width = opt.width + 'px';
            }
            if (opt.height != null) {
                dom.style.height = opt.height + 'px';
            }

            var theme = opt.theme && opt.theme !== 'none' ? opt.theme : null;
            if (theme == null && window.__ECHARTS__DEFAULT__THEME__) {
                theme = window.__ECHARTS__DEFAULT__THEME__;
            }
            if (theme) {
                require([`theme/${theme}`]);
            }

            var chart = echarts.init(dom, theme, {
                renderer: opt.renderer,
                useCoarsePointer: opt.useCoarsePointer,
                pointerSize: opt.pointerSize
            });

            if (opt.draggable) {
                if (!window.draggable) {
                    throw new Error(
                        errMsgPrefix + 'Pleasse add the script in HTML: \n'
                        + '<script src="lib/draggable.js"></script>'
                    );
                }
                window.draggable.init(dom, chart, {throttle: 70});
            }

            option && chart.setOption(option, {
                lazyUpdate: opt.lazyUpdate,
                notMerge: opt.notMerge
            });

            var isAutoResize = opt.autoResize == null ? true : opt.autoResize;
            if (isAutoResize) {
                testHelper.resizable(chart);
            }

            return chart;
        }
    };

    /**
     * @usage
     * ```js
     * testHelper.printAssert(chart, function (assert) {
     *     // If any error thrown here, a "checked: Fail" will be printed on the chart;
     *     // Otherwise, "checked: Pass" will be printed on the chart.
     *     assert(condition1);
     *     assert(condition2);
     *     assert(condition3);
     * });
     * ```
     * `testHelper.printAssert` can be called multiple times for one chart instance.
     * For each call, one result (fail or pass) will be printed.
     *
     * @param chartOrDomId {EChartsInstance | string}
     * @param checkFn {Function} param: a function `assert`.
     */
    testHelper.printAssert = function (chartOrDomId, checkerFn) {
        if (!chartOrDomId) {
            return;
        }

        var hostDOMEl;
        var chart;
        if (typeof chartOrDomId === 'string') {
            hostDOMEl = document.getElementById(chartOrDomId);
        }
        else {
            chart = chartOrDomId;
            hostDOMEl = chartOrDomId.getDom();
        }
        var failErr;
        function assert(cond) {
            if (!cond) {
                throw new Error();
            }
        }
        try {
            checkerFn(assert);
        }
        catch (err) {
            console.error(err);
            failErr = err;
        }
        var printAssertRecord = hostDOMEl.__printAssertRecord || (hostDOMEl.__printAssertRecord = []);

        var resultDom = document.createElement('div');
        resultDom.innerHTML = failErr ? 'checked: Fail' : 'checked: Pass';
        var fontSize = 40;
        resultDom.style.cssText = [
            'position: absolute;',
            'left: 20px;',
            'font-size: ' + fontSize + 'px;',
            'z-index: ' + (failErr ? 99999 : 88888) + ';',
            'color: ' + (failErr ? 'red' : 'green') + ';',
        ].join('');
        printAssertRecord.push(resultDom);
        hostDOMEl.appendChild(resultDom);

        relayoutResult();

        function relayoutResult() {
            var chartHeight = chart ? chart.getHeight() : hostDOMEl.offsetHeight;
            var lineHeight = Math.min(fontSize + 10, (chartHeight - 20) / printAssertRecord.length);
            for (var i = 0; i < printAssertRecord.length; i++) {
                var record = printAssertRecord[i];
                record.style.top = (10 + i * lineHeight) + 'px';
            }
        }
    };


    var _dummyRequestAnimationFrameMounted = false;

    /**
     * Usage:
     * ```js
     * testHelper.controlFrame({pauseAt: 60});
     * // Then load echarts.js (must after controlFrame called)
     * ```
     *
     * @param {Object} [opt]
     * @param {number} [opt.puaseAt] If specified `pauseAt`, auto pause at the frame.
     * @param {Function} [opt.onFrame]
     */
    testHelper.controlFrame = function (opt) {
        opt = opt || {};
        var pauseAt = opt.pauseAt;
        pauseAt == null && (pauseAt = 0);

        var _running = true;
        var _pendingCbList = [];
        var _frameNumber = 0;
        var _mounted = false;

        function getRunBtnText() {
            return _running ? 'pause' : 'run';
        }

        var buttons = [{
            text: getRunBtnText(),
            onclick: function () {
                buttons[0].el.innerHTML = getRunBtnText();
                _running ? pause() : run();
            }
        }, {
            text: 'next frame',
            onclick: nextFrame
        }];

        var btnPanel = document.createElement('div');
        btnPanel.className = 'control-frame-btn-panel'
        var infoEl = document.createElement('div');
        infoEl.className = 'control-frame-info';
        btnPanel.appendChild(infoEl);
        document.body.appendChild(btnPanel);
        for (var i = 0; i < buttons.length; i++) {
            var button = buttons[i];
            var btnEl = button.el = document.createElement('button');
            btnEl.innerHTML = button.text;
            btnEl.addEventListener('click', button.onclick);
            btnPanel.appendChild(btnEl);
        }

        if (_dummyRequestAnimationFrameMounted) {
            throw new Error('Do not support `controlFrame` twice');
        }
        _dummyRequestAnimationFrameMounted = true;
        var raf = window.requestAnimationFrame;
        window.requestAnimationFrame = function (cb) {
            _pendingCbList.push(cb);
            if (_running && !_mounted) {
                _mounted = true;
                raf(nextFrame);
            }
        };

        function run() {
            _running = true;
            nextFrame();
        }

        function pause() {
            _running = false;
        }

        function nextFrame() {
            opt.onFrame && opt.onFrame(_frameNumber);

            if (pauseAt != null && _frameNumber === pauseAt) {
                _running = false;
                pauseAt = null;
            }
            infoEl.innerHTML = 'Frame: ' + _frameNumber + ' ( ' + (_running ? 'Running' : 'Paused') + ' )';
            buttons[0].el.innerHTML = getRunBtnText();

            _mounted = false;
            var pending = _pendingCbList;
            _pendingCbList = [];
            for (var i = 0; i < pending.length; i++) {
                pending[i]();
            }
            _frameNumber++;
        }
    }

    testHelper.resizable = function (chart) {
        var dom = chart.getDom();
        var width = dom.clientWidth;
        var height = dom.clientHeight;
        function resize() {
            var newWidth = dom.clientWidth;
            var newHeight = dom.clientHeight;
            if (width !== newWidth || height !== newHeight) {
                chart.resize();
                width = newWidth;
                height = newHeight;
            }
        }
        if (window.attachEvent) {
            // Use builtin resize in IE
            window.attachEvent('onresize', chart.resize);
        }
        else if (window.addEventListener) {
            window.addEventListener('resize', resize, false);
        }
    };

    // Clean params specified by `cleanList` and seed a param specifid by `newVal` in URL.
    testHelper.setURLParam = function (cleanList, newVal) {
        var params = getParamListFromURL();
        for (var i = params.length - 1; i >= 0; i--) {
            for (var j = 0; j < cleanList.length; j++) {
                if (params[i] === cleanList[j]) {
                    params.splice(i, 1);
                }
            }
        }
        newVal && params.push(newVal);
        params.sort();
        location.search = params.join('&');
    };

    // Whether has param `val` in URL.
    testHelper.hasURLParam = function (val) {
        var params = getParamListFromURL();
        for (var i = params.length - 1; i >= 0; i--) {
            if (params[i] === val) {
                return true;
            }
        }
        return false;
    };

    // Nodejs `path.resolve`.
    testHelper.resolve = function () {
        var resolvedPath = '';
        var resolvedAbsolute;

        for (var i = arguments.length - 1; i >= 0 && !resolvedAbsolute; i--) {
            var path = arguments[i];
            if (path) {
                resolvedPath = path + '/' + resolvedPath;
                resolvedAbsolute = path[0] === '/';
            }
        }

        if (!resolvedAbsolute) {
            throw new Error('At least one absolute path should be input.');
        }

        // Normalize the path
        resolvedPath = normalizePathArray(resolvedPath.split('/'), false).join('/');

        return '/' + resolvedPath;
    };

    testHelper.encodeHTML = function (source) {
        return String(source)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    /**
     * @usage
     * var result = retrieveValue(val, defaultVal);
     * var result = retrieveValue(val1, val2, defaultVal);
     */
    testHelper.retrieveValue = function() {
        for (var i = 0, len = arguments.length; i < len; i++) {
            var val = arguments[i];
            if (val != null) {
                return val;
            }
        }
    };

    /**
     * @public
     * @return {string} Current url dir.
     */
    testHelper.dir = function () {
        return location.origin + testHelper.resolve(location.pathname, '..');
    };

    /**
     * Not accurate.
     * @param {*} type
     * @return {string} 'function', 'array', 'typedArray', 'regexp',
     *       'date', 'object', 'boolean', 'number', 'string'
     */
    var getType = testHelper.getType = function (value) {
        var type = typeof value;
        var typeStr = objToString.call(value);

        return !!TYPED_ARRAY[objToString.call(value)]
            ? 'typedArray'
            : typeof type === 'function'
            ? 'function'
            : typeStr === '[object Array]'
            ? 'array'
            : typeStr === '[object Number]'
            ? 'number'
            : typeStr === '[object Boolean]'
            ? 'boolean'
            : typeStr === '[object String]'
            ? 'string'
            : typeStr === '[object RegExp]'
            ? 'regexp'
            : typeStr === '[object Date]'
            ? 'date'
            : !!value && type === 'object'
            ? 'object'
            : null;
    };

    /**
     * JSON.stringify(obj, null, 2) will vertically layout array, which takes too much space.
     * Can print like:
     * [
     *     {name: 'xxx', value: 123},
     *     {name: 'xxx', value: 123},
     *     {name: 'xxx', value: 123}
     * ]
     * {
     *     arr: [33, 44, 55],
     *     str: 'xxx'
     * }
     *
     * @param {*} object
     * @param {opt|string} [opt] If string, means key.
     * @param {string} [opt.key=''] Top level key, if given, print like: 'someKey: [asdf]'
     * @param {string} [opt.objectLineBreak=true]
     * @param {string} [opt.arrayLineBreak=false]
     * @param {string} [opt.indent=4]
     * @param {string} [opt.lineBreak='\n']
     * @param {string} [opt.quotationMark='\'']
     */
    var printObject = testHelper.printObject = function (obj, opt) {
        opt = typeof opt === 'string'
            ? {key: opt}
            : (opt || {});

        var indent = opt.indent != null ? opt.indent : 4;
        var lineBreak = opt.lineBreak != null ? opt.lineBreak : '\n';
        var quotationMark = opt.quotationMark != null ? opt.quotationMark : '\'';

        return doPrint(obj, opt.key, 0).str;

        function doPrint(obj, key, depth) {
            var codeIndent = (new Array(depth * indent + 1)).join(' ');
            var subCodeIndent = (new Array((depth + 1) * indent + 1)).join(' ');
            var hasLineBreak = false;

            var preStr = key != null ? (key + ': ' ) : '';
            var str;

            var objType = getType(obj);

            switch (objType) {
                case 'function':
                    hasLineBreak = true;
                    str = preStr + quotationMark + obj + quotationMark;
                    break;
                case 'regexp':
                case 'date':
                    str = preStr + quotationMark + obj + quotationMark;
                    break;
                case 'array':
                case 'typedArray':
                    hasLineBreak = opt.arrayLineBreak != null ? opt.arrayLineBreak : false;
                    // If no break line in array, print in single line, like [12, 23, 34].
                    // else, each item takes a line.
                    var childBuilder = [];
                    for (var i = 0, len = obj.length; i < len; i++) {
                        var subResult = doPrint(obj[i], null, depth + 1);
                        childBuilder.push(subResult.str);
                        if (subResult.hasLineBreak) {
                            hasLineBreak = true;
                        }
                    }
                    var tail = hasLineBreak ? lineBreak : '';
                    var delimiter = ',' + (hasLineBreak ? (lineBreak + subCodeIndent) : ' ');
                    var subPre = hasLineBreak ? subCodeIndent : '';
                    var endPre = hasLineBreak ? codeIndent : '';
                    str = ''
                        + preStr + '[' + tail
                        + subPre + childBuilder.join(delimiter) + tail
                        + endPre + ']';
                    break;
                case 'object':
                    hasLineBreak = opt.objectLineBreak != null ? opt.objectLineBreak : true;
                    var childBuilder = [];
                    for (var i in obj) {
                        if (obj.hasOwnProperty(i)) {
                            var subResult = doPrint(obj[i], i, depth + 1);
                            childBuilder.push(subResult.str);
                            if (subResult.hasLineBreak) {
                                hasLineBreak = true;
                            }
                        }
                    }
                    str = ''
                        + preStr + '{' + (hasLineBreak ? lineBreak : '')
                        + (childBuilder.length
                            ? (hasLineBreak ? subCodeIndent : '') + childBuilder.join(',' + (hasLineBreak ? lineBreak + subCodeIndent: ' ')) + (hasLineBreak ? lineBreak: '')
                            : ''
                        )
                        + (hasLineBreak ? codeIndent : '') + '}';
                    break;
                case 'boolean':
                case 'number':
                    str = preStr + obj + '';
                    break;
                case 'string':
                    str = JSON.stringify(obj); // escapse \n\r or others.
                    str = preStr + quotationMark + str.slice(1, str.length - 1) + quotationMark;
                    break;
                default:
                    str = preStr + obj + '';
            }

            return {
                str: str,
                hasLineBreak: hasLineBreak
            };
        }
    };

    /**
     * Usage:
     * ```js
     * // Print all elements that has `style.text`:
     * var str = testHelper.stringifyElements(chart, {
     *     attr: ['z', 'z2', 'style.text', 'style.fill', 'style.stroke'],
     *     filter: el => el.style && el.style.text
     * });
     * ```
     *
     * @param {EChart} chart
     * @param {Object} [opt]
     * @param {string|Array.<string>} [opt.attr] Only print the given attrName;
     *        For example: 'z2' or ['z2', 'style.fill', 'style.stroke']
     * @param {function} [opt.filter] print a subtree only if any satisfied node exists.
     *        param: el, return: boolean
     */
    testHelper.stringifyElements = function (chart, opt) {
        if (!chart) {
            return;
        }
        opt = opt || {};
        var attrNameList = opt.attr;
        if (getType(attrNameList) !== 'array') {
            attrNameList = attrNameList ? [attrNameList] : [];
        }

        var zr = chart.getZr();
        var roots = zr.storage.getRoots();
        var plainRoots = [];

        retrieve(roots, plainRoots);

        var elsStr = printObject(plainRoots, {indent: 2});

        return elsStr;

        // Only retrieve the value of the given attrName.
        function retrieve(elList, plainNodes) {
            var anySatisfied = false;
            for (var i = 0; i < elList.length; i++) {
                var el = elList[i];

                var thisElSatisfied = !opt.filter || opt.filter(el);

                var plainNode = {};

                copyElment(plainNode, el);

                var textContent = el.getTextContent();
                if (textContent) {
                    plainNode.textContent = {};
                    copyElment(plainNode.textContent, textContent);
                }

                var thisSubAnySatisfied = false;
                if (el.isGroup) {
                    plainNode.children = [];
                    thisSubAnySatisfied = retrieve(el.childrenRef(), plainNode.children);
                }

                if (thisElSatisfied || thisSubAnySatisfied) {
                    plainNodes.push(plainNode);
                    anySatisfied = true;
                }
            }

            return anySatisfied;
        }

        function copyElment(plainNode, el) {
            for (var i = 0; i < attrNameList.length; i++) {
                var attrName = attrNameList[i];
                var attrParts = attrName.split('.');
                var partsLen = attrParts.length;
                if (!partsLen) {
                    continue;
                }
                var elInner = el;
                var plainInner = plainNode;
                for (var j = 0; j < partsLen - 1 && elInner; j++) {
                    var attr = attrParts[j];
                    elInner = el[attr];
                    if (elInner) {
                        plainInner = plainInner[attr] || (plainInner[attr] = {});
                    }
                }
                var attr = attrParts[partsLen - 1];
                if (elInner && elInner.hasOwnProperty(attr)) {
                    plainInner[attr] = elInner[attr];
                }
            }
        }
    };

    /**
     * Usage:
     * ```js
     * // Print all elements that has `style.text`:
     * testHelper.printElements(chart, {
     *     attr: ['z', 'z2', 'style.text', 'style.fill', 'style.stroke'],
     *     filter: el => el.style && el.style.text
     * });
     * ```
     *
     * @see `stringifyElements`.
     */
    testHelper.printElements = function (chart, opt) {
        var elsStr = testHelper.stringifyElements(chart, opt);
        console.log(elsStr);
    };

    /**
     * Usage:
     * ```js
     * // Print all elements that has `style.text`:
     * testHelper.retrieveElements(chart, {
     *     filter: el => el.style && el.style.text
     * });
     * ```
     *
     * @param {EChart} chart
     * @param {Object} [opt]
     * @param {function} [opt.filter] print a subtree only if any satisfied node exists.
     *        param: el, return: boolean
     * @return {Array.<Element>}
     */
    testHelper.retrieveElements = function (chart, opt) {
        if (!chart) {
            return;
        }
        opt = opt || {};
        var attrNameList = opt.attr;
        if (getType(attrNameList) !== 'array') {
            attrNameList = attrNameList ? [attrNameList] : [];
        }

        var zr = chart.getZr();
        var roots = zr.storage.getRoots();
        var result = [];

        retrieve(roots);

        function retrieve(elList) {
            for (var i = 0; i < elList.length; i++) {
                var el = elList[i];
                if (!opt.filter || opt.filter(el)) {
                    result.push(el);
                }
                if (el.isGroup) {
                    retrieve(el.childrenRef());
                }
            }
        }

        return result;
    };

    // opt: {record: JSON, width: number, height: number}
    testHelper.reproduceCanteen = function (opt) {
        var canvas = document.createElement('canvas');
        canvas.style.width = opt.width + 'px';
        canvas.style.height = opt.height + 'px';
        var dpr = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = opt.width * dpr;
        canvas.height = opt.height * dpr;

        var ctx = canvas.getContext('2d');
        var record = opt.record;

        for (var i = 0; i < record.length; i++) {
            var line = record[i];
            if (line.attr) {
                if (!line.hasOwnProperty('val')) {
                    alertIllegal(line);
                }
                ctx[line.attr] = line.val;
            }
            else if (line.method) {
                if (!line.hasOwnProperty('arguments')) {
                    alertIllegal(line);
                }
                ctx[line.method].apply(ctx, line.arguments);
            }
            else {
                alertIllegal(line);
            }
        }

        function alertIllegal(line) {
            throw new Error('Illegal line: ' + JSON.stringify(line));
        }

        document.body.appendChild(canvas);
    };

    function createDataTableHTML(data, opt) {
        var sourceFormat = detectSourceFormat(data);
        var dataTableLimit = opt.dataTableLimit || DEFAULT_DATA_TABLE_LIMIT;

        if (!sourceFormat) {
            return '';
        }

        var html = ['<table><tbody>'];

        if (sourceFormat === 'arrayRows') {
            for (var i = 0; i < data.length && i <= dataTableLimit; i++) {
                var line = data[i];
                var htmlLine = ['<tr>'];
                for (var j = 0; j < line.length; j++) {
                    var val = i === dataTableLimit ? '...' : line[j];
                    htmlLine.push('<td>' + testHelper.encodeHTML(val) + '</td>');
                }
                htmlLine.push('</tr>');
                html.push(htmlLine.join(''));
            }
        }
        else if (sourceFormat === 'objectRows') {
            for (var i = 0; i < data.length && i <= dataTableLimit; i++) {
                var line = data[i];
                var htmlLine = ['<tr>'];
                for (var key in line) {
                    if (line.hasOwnProperty(key)) {
                        var keyText = i === dataTableLimit ? '...' : key;
                        htmlLine.push('<td class="test-data-table-key">' + testHelper.encodeHTML(keyText) + '</td>');
                        var val = i === dataTableLimit ? '...' : line[key];
                        htmlLine.push('<td>' + testHelper.encodeHTML(val) + '</td>');
                    }
                }
                htmlLine.push('</tr>');
                html.push(htmlLine.join(''));
            }
        }
        else if (sourceFormat === 'keyedColumns') {
            for (var key in data) {
                var htmlLine = ['<tr>'];
                htmlLine.push('<td class="test-data-table-key">' + testHelper.encodeHTML(key) + '</td>');
                if (data.hasOwnProperty(key)) {
                    var col = data[key] || [];
                    for (var i = 0; i < col.length && i <= dataTableLimit; i++) {
                        var val = i === dataTableLimit ? '...' : col[i];
                        htmlLine.push('<td>' + testHelper.encodeHTML(val) + '</td>');
                    }
                }
                htmlLine.push('</tr>');
                html.push(htmlLine.join(''));
            }
        }

        html.push('</tbody></table>');

        return html.join('');
    }

    function detectSourceFormat(data) {
        if (data.length) {
            for (var i = 0, len = data.length; i < len; i++) {
                var item = data[i];

                if (item == null) {
                    continue;
                }
                else if (item.length) {
                    return 'arrayRows';
                }
                else if (typeof data === 'object') {
                    return 'objectRows';
                }
            }
        }
        else if (typeof data === 'object') {
            return 'keyedColumns';
        }
    }

    function createObjectHTML(obj, key) {
        var html = isObject(obj)
            ? testHelper.encodeHTML(printObject(obj, key))
            : obj
            ? obj.toString()
            : '';

        return [
            '<pre class="test-print-object">',
            html,
            '</pre>'
        ].join('');
    }

    var getDom = testHelper.getDom = function (domOrId) {
        return getType(domOrId) === 'string' ? document.getElementById(domOrId) : domOrId;
    }


    // resolves . and .. elements in a path array with directory names there
    // must be no slashes or device names (c:\) in the array
    // (so also no leading and trailing slashes - it does not distinguish
    // relative and absolute paths)
    function normalizePathArray(parts, allowAboveRoot) {
        var res = [];
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i];

            // ignore empty parts
            if (!p || p === '.') {
                continue;
            }

            if (p === '..') {
                if (res.length && res[res.length - 1] !== '..') {
                    res.pop();
                } else if (allowAboveRoot) {
                    res.push('..');
                }
            } else {
                res.push(p);
            }
        }

        return res;
    }

    function getParamListFromURL() {
        var params = location.search.replace('?', '');
        return params ? params.split('&') : [];
    }

    function isObject(value) {
        // Avoid a V8 JIT bug in Chrome 19-20.
        // See https://code.google.com/p/v8/issues/detail?id=2291 for more details.
        var type = typeof value;
        return type === 'function' || (!!value && type === 'object');
    }

    function arrayIndexOf(arr, value) {
        if (arr.indexOf) {
            return arr.indexOf(value);
        }
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] === value) {
                return i;
            }
        }
        return -1;
    }

    function makeFlexibleNames(dashedNames) {
        var nameMap = {};
        for (var i = 0; i < dashedNames.length; i++) {
            var name = dashedNames[i];
            var tmpNames = [];
            tmpNames.push(name);
            tmpNames.push(name.replace(/-/g, ''));
            tmpNames.push(name.replace(/-/g, '_'));
            tmpNames.push(name.replace(/-([a-zA-Z0-9])/g, function (_, wf) {
                return wf.toUpperCase();
            }));
            for (var j = 0; j < tmpNames.length; j++) {
                nameMap[tmpNames[j]] = 1;
                nameMap[tmpNames[j].toUpperCase()] = 1;
                nameMap[tmpNames[j].toLowerCase()] = 1;
            }
        }
        var names = [];
        for (var name in nameMap) {
            if (nameMap.hasOwnProperty(name)) {
                names.push(name);
            }
        }
        return names;
    }

    function objectNoOtherNotNullUndefinedPropExcept(obj, exceptProps) {
        if (!obj) {
            return false;
        }
        for (var key in obj) {
            if (obj.hasOwnProperty(key) && arrayIndexOf(exceptProps, key) < 0 && obj[key] != null) {
                return false;
            }
        }
        return true;
    }

    var _idBase = 1;
    function generateId(prefix) {
        return prefix + '' + (_idBase++);
    }

    function VideoRecorder(chart) {
        this.start = startRecording;
        this.stop = stopRecording;

        var recorder = null;

        var oldRefreshImmediately = chart.getZr().refreshImmediately;

        function startRecording() {
            // Normal resolution or high resolution?
            var compositeCanvas = document.createElement('canvas');
            var width = chart.getWidth();
            var height = chart.getHeight();
            compositeCanvas.width = width;
            compositeCanvas.height = height;
            var compositeCtx = compositeCanvas.getContext('2d');

            chart.getZr().refreshImmediately = function () {
                var ret = oldRefreshImmediately.apply(this, arguments);
                var canvasList = chart.getDom().querySelectorAll('canvas');
                compositeCtx.fillStyle = '#fff';
                compositeCtx.fillRect(0, 0, width, height);
                for (var i = 0; i < canvasList.length; i++) {
                    compositeCtx.drawImage(canvasList[i], 0, 0, width, height);
                }
                return ret;
            }

            var stream = compositeCanvas.captureStream(25);
            recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });

            var videoData = [];
            recorder.ondataavailable = function (event) {
                if (event.data && event.data.size) {
                    videoData.push(event.data);
                }
            };

            recorder.onstop = function () {
                var url = URL.createObjectURL(new Blob(videoData, { type: 'video/webm' }));

                var a = document.createElement('a');
                a.href = url;
                a.download = 'recording.webm';
                a.click();

                setTimeout(function () {
                    window.URL.revokeObjectURL(url);
                }, 100);
            };

            recorder.start();
        }

        function stopRecording() {
            if (recorder) {
                chart.getZr().refreshImmediately = oldRefreshImmediately;
                recorder.stop();
            }
        }
    }

    context.testHelper = testHelper;

})(window);